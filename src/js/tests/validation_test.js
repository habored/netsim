import { NetworkUtils } from '../network-utils.js';

function testNetmaskValidation() {
    console.log("--- Starting Network Validation Tests ---");

    const maskCases = [
        { mask: "255.255.255.0", expected: true },
        { mask: "255.255.0.0", expected: true },
        { mask: "255.240.0.0", expected: true },
        { mask: "128.0.0.0", expected: true },
        { mask: "255.255.255.255", expected: true },
        { mask: "0.0.0.0", expected: true },
        // Cas invalides (masques non contigus)
        { mask: "255.255.0.255", expected: false },
        { mask: "255.0.255.0", expected: false },
        { mask: "0.255.255.255", expected: false },
        // Cas malformés
        { mask: "256.255.255.0", expected: false },
        { mask: "string", expected: false },
        { mask: "192.168.1", expected: false }
    ];

    maskCases.forEach(c => {
        const result = NetworkUtils.isValidNetmask(c.mask);
        if (result !== c.expected) console.error(`❌ Mask fail: ${c.mask}`);
    });

    console.log("--- Starting NAT Conflict Tests ---");
    
    const existingMappings = [
        { private_ip: "192.168.1.10", public_ip: "80.0.0.1" },
        { private_ip: "192.168.1.11", public_ip: "80.0.0.2" }
    ];

    const natCases = [
        { newIp: "80.0.0.1", type: 'public', expected: true },  // Conflit public
        { newIp: "80.0.0.3", type: 'public', expected: false }, // OK public
        { newIp: "192.168.1.10", type: 'private', expected: true }, // Conflit privé
        { newIp: "192.168.1.50", type: 'private', expected: false }  // OK privé
    ];

    natCases.forEach(c => {
        const result = NetworkUtils.hasNatConflict(existingMappings, c.newIp, c.type);
        if (result !== c.expected) console.error(`❌ NAT Conflict detection fail for ${c.newIp}`);
    });

    console.log("--- Starting Host IP Validation (Scenario 02) ---");
    const hostCases = [
        { ip: "192.168.1.0", mask: "255.255.255.0", expected: false },   // Network IP
        { ip: "192.168.1.255", mask: "255.255.255.0", expected: false }, // Broadcast
        { ip: "192.168.1.1", mask: "255.255.255.0", expected: true }     // Host IP
    ];

    hostCases.forEach(c => {
        const result = NetworkUtils.isValidHostIp(c.ip, c.mask);
        if (result !== c.expected) console.error(`❌ Host validation fail for ${c.ip}`);
    });

    console.log("Validation complete.");
}

testNetmaskValidation();