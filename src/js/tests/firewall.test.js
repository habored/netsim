// Mock networkUtils
jest.mock('./networkUtils.js', () => ({
    normalizeIPv4Value: jest.fn(ip => {
        if (ip === null || typeof ip === 'number') return ip;
        const parts = ip.split('.').map(Number);
        return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
    }),
    normalizeMask: jest.fn(mask => {
        if (mask === null || typeof mask === 'number') return mask;
        if (typeof mask === 'string' && mask.includes('.')) { // Dotted decimal
            const parts = mask.split('.').map(Number);
            return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
        } else if (typeof mask === 'string') { // CIDR prefix
            const prefix = parseInt(mask, 10);
            return prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0;
        }
        return null; // Should not happen if input is valid
    }),
    ipToString: jest.fn(ip => {
        if (ip === null) return 'any';
        return `${(ip >>> 24) & 0xFF}.${(ip >>> 16) & 0xFF}.${(ip >>> 8) & 0xFF}.${ip & 0xFF}`;
    }),
}));

// Mock network-core for Packet and ICMPMessage
jest.mock('./network-core.js', () => ({
    Packet: jest.fn((srcIP, destIP, content, ttl, protocol) => ({
        srcIP, destIP, content, ttl, protocol,
        clone: jest.fn(() => ({ srcIP, destIP, content, ttl, protocol })) // Simple clone
    })),
    ICMPMessage: jest.fn((type, options) => ({ type, ...options })),
}));

const { Firewall } = require('./firewall.js');
const { Packet, ICMPMessage } = require('./network-core.js');
const { normalizeIPv4Value, normalizeMask } = require('./networkUtils.js');

describe('Firewall', () => {
    let firewall;

    beforeEach(() => {
        firewall = new Firewall();
        jest.clearAllMocks();
        // Reset mock implementations for networkUtils for each test
        normalizeIPv4Value.mockImplementation(ip => {
            if (ip === null || typeof ip === 'number') return ip;
            const parts = ip.split('.').map(Number);
            return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
        });
        normalizeMask.mockImplementation(mask => {
            if (mask === null || typeof mask === 'number') return mask;
            if (typeof mask === 'string' && mask.includes('.')) { // Dotted decimal
                const parts = mask.split('.').map(Number);
                return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
            } else if (typeof mask === 'string') { // CIDR prefix
                const prefix = parseInt(mask, 10);
                return prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0;
            }
            return null;
        });
    });

    describe('addAccessRule', () => {
        it('should normalize IP and mask values and add the rule', () => {
            firewall.addAccessRule('192.168.1.0', '255.255.255.0', '10.0.0.1', '255.255.255.255', 'TCP', 'allow');
            expect(firewall.accessRules).toHaveLength(1);
            expect(firewall.accessRules[0]).toEqual({
                src_ip: normalizeIPv4Value('192.168.1.0') & normalizeMask('255.255.255.0'),
                src_mask: normalizeMask('255.255.255.0'),
                dst_ip: normalizeIPv4Value('10.0.0.1') & normalizeMask('255.255.255.255'),
                dst_mask: normalizeMask('255.255.255.255'),
                protocol: ['TCP'],
                action: 'allow'
            });
        });

        it('should handle "any" for IP, mask, and protocol', () => {
            firewall.addAccessRule(null, null, 'any', '', 'any', 'deny');
            expect(firewall.accessRules).toHaveLength(1);
            expect(firewall.accessRules[0]).toEqual({
                src_ip: null,
                src_mask: null,
                dst_ip: null,
                dst_mask: null,
                protocol: null,
                action: 'deny'
            });
        });

        it('should handle numeric IP and mask values directly', () => {
            const srcIpNum = 0xC0A8010A; // 192.168.1.10
            const srcMaskNum = 0xFFFFFF00; // 255.255.255.0
            firewall.addAccessRule(srcIpNum, srcMaskNum, null, null, null, 'allow');
            expect(firewall.accessRules).toHaveLength(1);
            expect(firewall.accessRules[0]).toEqual({
                src_ip: srcIpNum & srcMaskNum,
                src_mask: srcMaskNum,
                dst_ip: null,
                dst_mask: null,
                protocol: null,
                action: 'allow'
            });
        });
    });

    describe('_ipMatch', () => {
        const ip = normalizeIPv4Value('192.168.1.10');
        const network = normalizeIPv4Value('192.168.1.0');
        const mask24 = normalizeMask('255.255.255.0');
        const hostMask = normalizeMask('255.255.255.255');

        it('should match any IP if ruleIp is null/undefined', () => {
            expect(firewall._ipMatch(ip, null, mask24)).toBe(true);
            expect(firewall._ipMatch(ip, undefined, mask24)).toBe(true);
        });

        it('should match exact IP if ruleMask is null/undefined', () => {
            expect(firewall._ipMatch(ip, ip, null)).toBe(true);
            expect(firewall._ipMatch(ip, ip, undefined)).toBe(true);
            expect(firewall._ipMatch(ip, network, null)).toBe(false);
        });

        it('should match network address with mask', () => {
            expect(firewall._ipMatch(ip, network, mask24)).toBe(true);
            expect(firewall._ipMatch(normalizeIPv4Value('192.168.2.10'), network, mask24)).toBe(false);
        });

        it('should match host IP with /32 mask', () => {
            expect(firewall._ipMatch(ip, ip, hostMask)).toBe(true);
            expect(firewall._ipMatch(normalizeIPv4Value('192.168.1.11'), ip, hostMask)).toBe(false);
        });
    });

    describe('checkAccessExtended', () => {
        const srcIP = normalizeIPv4Value('192.168.1.10');
        const destIP = normalizeIPv4Value('10.0.0.1');
        const loopbackIP = normalizeIPv4Value('127.0.0.1');
        const packet = new Packet(srcIP, destIP, new ICMPMessage('echo-request'), 64, 'ICMP');
        const loopbackPacket = new Packet(loopbackIP, destIP, new ICMPMessage('echo-request'), 64, 'ICMP');
        const destLoopbackPacket = new Packet(srcIP, loopbackIP, new ICMPMessage('echo-request'), 64, 'ICMP');
        const tcpPacket = new Packet(srcIP, destIP, {}, 64, 'TCP');

        it('should allow loopback traffic regardless of rules', () => {
            firewall.defaultPolicy = 'deny';
            firewall.addAccessRule(null, null, null, null, null, 'deny'); // Explicit deny all
            expect(firewall.checkAccessExtended(loopbackPacket).allowed).toBe(true);
            expect(firewall.checkAccessExtended(loopbackPacket).reason).toBe('trafic local (loopback)');
            expect(firewall.checkAccessExtended(destLoopbackPacket).allowed).toBe(true);
            expect(firewall.checkAccessExtended(destLoopbackPacket).reason).toBe('trafic local (loopback)');
        });

        it('should deny by default policy if no rules match and policy is deny', () => {
            firewall.defaultPolicy = 'deny';
            expect(firewall.checkAccessExtended(packet).allowed).toBe(false);
            expect(firewall.checkAccessExtended(packet).reason).toBe('politique par défaut (deny)');
        });

        it('should allow by default policy if no rules match and policy is allow', () => {
            firewall.defaultPolicy = 'allow';
            expect(firewall.checkAccessExtended(packet).allowed).toBe(true);
            expect(firewall.checkAccessExtended(packet).reason).toBe('politique par défaut (allow)');
        });

        it('should allow if an explicit allow rule matches', () => {
            firewall.addAccessRule(srcIP, normalizeMask('255.255.255.255'), destIP, normalizeMask('255.255.255.255'), 'ICMP', 'allow');
            firewall.addAccessRule(null, null, null, null, null, 'deny'); // Default deny after this rule
            expect(firewall.checkAccessExtended(packet).allowed).toBe(true);
            expect(firewall.checkAccessExtended(packet).reason).toBe('règle ACL #1 (allow)');
        });

        it('should deny if an explicit deny rule matches', () => {
            firewall.addAccessRule(srcIP, normalizeMask('255.255.255.255'), destIP, normalizeMask('255.255.255.255'), 'ICMP', 'deny');
            firewall.defaultPolicy = 'allow'; // Default allow after this rule
            expect(firewall.checkAccessExtended(packet).allowed).toBe(false);
            expect(firewall.checkAccessExtended(packet).reason).toBe('règle ACL #1 (deny)');
        });

        it('should match protocol (single string)', () => {
            firewall.addAccessRule(null, null, null, null, 'TCP', 'allow');
            firewall.defaultPolicy = 'deny';
            expect(firewall.checkAccessExtended(tcpPacket).allowed).toBe(true);
            expect(firewall.checkAccessExtended(packet).allowed).toBe(false); // ICMP should not match TCP rule
        });

        it('should match protocol (array of strings)', () => {
            firewall.addAccessRule(null, null, null, null, ['TCP', 'UDP'], 'allow');
            firewall.defaultPolicy = 'deny';
            expect(firewall.checkAccessExtended(tcpPacket).allowed).toBe(true);
            expect(firewall.checkAccessExtended(packet).allowed).toBe(false); // ICMP should not match TCP/UDP rule
        });

        it('should match "any" protocol', () => {
            firewall.addAccessRule(null, null, null, null, 'any', 'allow');
            firewall.defaultPolicy = 'deny';
            expect(firewall.checkAccessExtended(tcpPacket).allowed).toBe(true);
            expect(firewall.checkAccessExtended(packet).allowed).toBe(true);
        });
    });

    describe('applyNat', () => {
        const publicIp = normalizeIPv4Value('203.0.113.10');
        const publicMask = normalizeMask('255.255.255.255');
        const privateIp = normalizeIPv4Value('192.168.1.10');
        const privateMask = normalizeMask('255.255.255.255');

        const publicNetwork = normalizeIPv4Value('203.0.113.0');
        const publicNetworkMask = normalizeMask('255.255.255.0');
        const privateNetwork = normalizeIPv4Value('192.168.1.0');
        const privateNetworkMask = normalizeMask('255.255.255.0');

        const originalPacket = new Packet(privateIp, normalizeIPv4Value('8.8.8.8'), new ICMPMessage('echo-request'), 64, 'ICMP');
        const inboundPacket = new Packet(normalizeIPv4Value('8.8.8.8'), publicIp, new ICMPMessage('echo-request'), 64, 'ICMP');
        const originalIcmpWithOriginalDest = new Packet(privateIp, normalizeIPv4Value('8.8.8.8'), new ICMPMessage('destination-unreachable', { originalDestination: privateIp }), 64, 'ICMP');

        it('should return original packet if no NAT rule matches', () => {
            const translated = firewall.applyNat(originalPacket, 'outbound');
            expect(translated).toBe(originalPacket);
        });

        it('should apply outbound SNAT (IP to IP)', () => {
            firewall.addNatRule(publicIp, publicMask, privateIp, privateMask);
            const translated = firewall.applyNat(originalPacket, 'outbound');
            expect(translated.srcIP).toBe(publicIp);
            expect(translated.destIP).toBe(originalPacket.destIP);
            expect(translated).not.toBe(originalPacket); // Should return a new packet
        });

        it('should apply inbound DNAT (IP to IP)', () => {
            firewall.addNatRule(publicIp, publicMask, privateIp, privateMask);
            const translated = firewall.applyNat(inboundPacket, 'inbound');
            expect(translated.srcIP).toBe(inboundPacket.srcIP);
            expect(translated.destIP).toBe(privateIp);
            expect(translated).not.toBe(inboundPacket);
        });

        it('should apply outbound NAT (network to network)', () => {
            const privateHost = normalizeIPv4Value('192.168.1.50');
            const publicTranslatedHost = normalizeIPv4Value('203.0.113.50');
            firewall.addNatRule(publicNetwork, publicNetworkMask, privateNetwork, privateNetworkMask);
            const packetFromPrivateHost = new Packet(privateHost, normalizeIPv4Value('8.8.8.8'), new ICMPMessage('echo-request'), 64, 'ICMP');
            const translated = firewall.applyNat(packetFromPrivateHost, 'outbound');
            expect(translated.srcIP).toBe(publicTranslatedHost);
            expect(translated.destIP).toBe(packetFromPrivateHost.destIP);
        });

        it('should apply inbound NAT (network to network)', () => {
            const publicHost = normalizeIPv4Value('203.0.113.70');
            const privateTranslatedHost = normalizeIPv4Value('192.168.1.70');
            firewall.addNatRule(publicNetwork, publicNetworkMask, privateNetwork, privateNetworkMask);
            const packetToPublicHost = new Packet(normalizeIPv4Value('8.8.8.8'), publicHost, new ICMPMessage('echo-request'), 64, 'ICMP');
            const translated = firewall.applyNat(packetToPublicHost, 'inbound');
            expect(translated.srcIP).toBe(packetToPublicHost.srcIP);
            expect(translated.destIP).toBe(privateTranslatedHost);
        });

        it('should update ICMP originalDestination if it was translated', () => {
            firewall.addNatRule(publicIp, publicMask, privateIp, privateMask);
            const translated = firewall.applyNat(originalIcmpWithOriginalDest, 'outbound');
            expect(translated.srcIP).toBe(publicIp);
            expect(translated.content.originalDestination).toBe(publicIp); // originalDestination should be updated
        });
    });
});
