
import { StaticNATEngine } from './src/model/nat-engine.js';

function runNATTests() {
   const nat = new StaticNATEngine();

   console.log("--- Test 1 : Ajout et Conflit ---");
   nat.addRule("203.0.113.1", "192.168.1.10");
   try {
       nat.addRule("203.0.113.1", "192.168.1.50"); // Doit échouer
   } catch (e) {
       console.log("OK: Conflit IP publique détecté.");
   }

   console.log("\n--- Test 2 : Translation Sortante (SNAT) ---");
   let pOut = { src_ip: "192.168.1.10", dst_ip: "8.8.8.8", payload: "Ping" };
   let resOut = nat.translate(pOut);
   console.log(`SNAT: ${resOut.src_ip} (Attendu: 203.0.113.1)`);

   console.log("\n--- Test 3 : Translation Entrante (DNAT) ---");
   let pIn = { src_ip: "8.8.8.8", dst_ip: "203.0.113.1", payload: "Reply" };
   let resIn = nat.translate(pIn);
   console.log(`DNAT: ${resIn.dst_ip} (Attendu: 192.168.1.10)`);

   console.log("\n--- Test 4 : Filtrage (Paquet non autorisé) ---");
   let pRogue = { src_ip: "8.8.8.8", dst_ip: "203.0.113.200", payload: "Exploit" };
   let resRogue = nat.translate(pRogue);
   console.log(`Filtrage: ${resRogue === null ? "REJETÉ" : "ADMIS"} (Attendu: REJETÉ)`);

   console.log("\n--- Test 5 : Suppression ---");
   nat.removeRule("203.0.113.1");
   let pAfter = { src_ip: "192.168.1.10", dst_ip: "8.8.8.8" };
   console.log(`Après suppression: ${nat.translate(pAfter) === null ? "REJETÉ" : "ADMIS"}`);
}

runNATTests();
