/**
 * Vérifie si un masque binaire est contigu (ex: 255.255.128.0 est OK, 255.0.255.0 est KO).
 */
export function isMaskContiguous(maskInt) {
    if (maskInt === 0) return true;
    // On inverse les bits et on ajoute 1. 
    // Si le masque est contigu (11110000), alors (~mask + 1) est une puissance de 2.
    const inverted = (~maskInt >>> 0);
    return (inverted & (inverted + 1)) === 0;
}

export function validateMask(maskStr) {
    // Logique utilisée par l'UI pour bloquer les entrées invalides
    // ... implémentation utilisant isMaskContiguous
}