import { ipToString } from "./network-utils.js";

/**
 * Nesiin v1.1 - Gestionnaire RIP
 * Implémente la RFC 2453 avec mécanismes anti-boucles.
 */
export class RIPManager {
    constructor(router) {
        this.router = router;
        this.INFINITY = 16;
    }

    /**
     * Applique le Split Horizon avec Poison Reverse.
     * Si une route a été apprise sur l'interface de sortie, on l'annonce à 16.
     */
    generateUpdatePayload(outInterface) {
        // Filtrage des routes via le redistributeur
        const eligibleRoutes = this.router.getRoutes().filter(route => 
            this.router.redistributor.shouldRedistribute(route, 'rip')
        );

        return eligibleRoutes.map(route => {
            // Traduction de la métrique (ex: OSPF cost 100 -> RIP metric 1)
            let advertisedMetric = this.router.redistributor.getTranslatedMetric(route, 'rip');
            
            // Mécanique Poison Reverse
            if (route.kind === 'rip' && route.outInterface === outInterface) {
                advertisedMetric = this.INFINITY;
            }

            return {
                networkIp: route.networkIp,
                networkMask: route.networkMask,
                cost: advertisedMetric,
                tag: route.kind === 'rip' ? route.tag : route.kind // On transmet l'origine
            };
        });
    }

    /**
     * Traite les mises à jour et gère le comptage à l'infini.
     */
    processUpdate(srcIp, incomingIface, ripPayload) {
        const currentTime = this.router.currentSimTime || Date.now();
        let hasChanged = false;

        ripPayload.routes.forEach(adv => {
            const networkIp = adv.networkIp;
            const networkMask = adv.networkMask;
            const newMetric = Math.min(adv.cost + 1, this.INFINITY);

            // Recherche de la route existante (Longest Prefix Match)
            const existing = this.router.routingTable.find(r => 
                r.networkIp === networkIp && r.networkMask === networkMask && r.kind === 'rip'
            );

            if (existing) {
                // Si l'info vient du même voisin, on met à jour même si c'est pire (Poisoning)
                if (existing.nextHop === srcIp) {
                    if (existing.cost !== newMetric) {
                        existing.cost = newMetric;
                        existing.lastUpdated = Date.now();
                        hasChanged = true;
                    }
                } 
                // Sinon, on ne prend que si c'est strictement meilleur
                else if (newMetric < existing.cost) {
                    existing.cost = newMetric;
                    existing.nextHop = srcIp;
                    existing.outInterface = incomingIface;
                    existing.lastUpdated = currentTime;
                    hasChanged = true;
                }
            } else if (newMetric < this.INFINITY) {
                // Nouvelle route
                this.router.addRoute(networkIp, networkMask, srcIp, incomingIface, newMetric, 'rip', adv.tag);
                hasChanged = true;
            }
        });

        // TRIGGERED UPDATE : Si la topologie change, on n'attend pas les 30s
        if (hasChanged) {
            this.router.broadcastRipUpdate();
        }
        
        return hasChanged;
    }

    /**
     * Empoisonnement immédiat des routes lors d'une coupure de lien.
     */
    handleInterfaceDown(iface) {
        let poisoned = false;
        this.router.routingTable.forEach(route => {
            if (route.outInterface === iface) {
                route.cost = this.INFINITY;
                poisoned = true;
            }
        });
        if (poisoned) this.router.broadcastRipUpdate();
    }

    /**
     * Gère l'expiration des routes (Timeout) et leur retrait (Flush).
     * @param {number} now Temps actuel de la simulation
     */
    updateAging(now) {
        const TIMEOUT = 60000; // 60s avant d'invalider (Métrique 16) pour la pédagogie
        const FLUSH = 30000;   // 30s supplémentaires avant retrait définitif
        let hasChanged = false;

        this.router.routingTable = this.router.routingTable.filter(route => {
            if (route.kind !== "rip") return true;

            const lastUpdate = route.lastUpdated || 0;
            const age = now - lastUpdate;

            // 1. Timeout : La route n'est plus rafraîchie par le voisin
            if (route.cost < this.INFINITY && age > TIMEOUT) {
                route.cost = this.INFINITY;
                route.poisonedAt = now;
                hasChanged = true;
                this.router.broadcastRipUpdate(); // On prévient les autres que la route est morte
            }

            // 2. Flush : Retrait définitif de la table après la période d'empoisonnement
            if (route.cost === this.INFINITY) {
                const poisonAge = now - (route.poisonedAt || lastUpdate);
                if (poisonAge > FLUSH) {
                    hasChanged = true;
                    return false; // Supprime de la table
                }
            }
            return true;
        });

        if (hasChanged) {
            this.router.notifyStateChange();
        }
    }
}