export function newSeed(previous?: number): number {
  let stored: number | undefined;
  try {
    const value = localStorage.getItem('singularity.seed');
    if (value !== null) stored = Number(value);
  } catch {
    // Random runs still work when storage is unavailable.
  }
  const random = new Uint32Array(1);
  do {
    crypto.getRandomValues(random);
  } while (random[0] === previous || random[0] === stored);
  const seed = random[0];
  try {
    localStorage.setItem('singularity.seed', String(seed));
  } catch {
    // Persistence only prevents a chance repeat across page loads.
  }
  return seed;
}
