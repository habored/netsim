/**
 * Nesiin v1.1 - RouteRedistributor
 * Gère l'échange de routes entre différents domaines de routage (RIP, OSPF, Statique).
 */
export class RouteRedistributor {
    constructor() {
        // Configuration par défaut : métriques de départ (Seed Metrics)
        // RIP utilise des sauts (1-15), OSPF utilise des coûts (1-65535)
        this.seedMetrics = {
            rip: 1,      // Métrique appliquée aux routes injectées dans RIP
            ospf: 20     // Coût appliqué aux routes injectées dans OSPF (E2 par défaut)
        };

        // Protocoles autorisés à être redistribués par défaut
        // Dans un cadre pédagogique, on active souvent Statique -> Dynamique par défaut
        this.enabledRedistributions = {
            rip: ['static', 'connected'],
            ospf: ['static', 'connected']
        };
    }

    /**
     * Détermine si une route doit être exportée vers un protocole spécifique.
     */
    shouldRedistribute(route, targetProtocol) {
        if (route.kind === targetProtocol) return true; // Pas de redistribution, c'est natif
        
        // ANTI-FEEDBACK : Si la route porte déjà le tag du protocole cible, 
        // cela signifie qu'elle en provient originellement. On bloque pour éviter la boucle.
        if (route.tag === targetProtocol) return false;

        const allowed = this.enabledRedistributions[targetProtocol] || [];
        return allowed.includes(route.kind);
    }

    /**
     * Calcule la métrique appropriée pour le protocole cible.
     */
    getTranslatedMetric(route, targetProtocol) {
        if (route.kind === targetProtocol) {
            return route.cost;
        }
        
        // Si c'est une route connectée, on garde souvent un coût minimal
        if (route.kind === 'connected') return 1;

        // Sinon, on utilise la seed metric configurée
        return this.seedMetrics[targetProtocol] || 1;
    }

    enable(sourceProtocol, targetProtocol) {
        if (!this.enabledRedistributions[targetProtocol].includes(sourceProtocol)) {
            this.enabledRedistributions[targetProtocol].push(sourceProtocol);
        }
    }
}