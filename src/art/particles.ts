function sphere(diameter: number): string[] {
  const radius = diameter / 2;
  return Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => {
      const dx = x - 7.5,
        dy = y - 7.5,
        distance = Math.hypot(dx, dy);
      if (distance > radius) return '.';
      if (distance > radius - 1) return '1';
      if (dx < -radius * 0.1 && dx > -radius * 0.65 && dy < -radius * 0.15 && dy > -radius * 0.7)
        return '4';
      return Math.hypot(dx + radius * 0.25, dy + radius * 0.3) > radius * 0.78 ? '2' : '3';
    }).join(''),
  );
}

const electron = sphere(12);
export const particleArt = {
  electron,
  electronSurge: electron,
  quark: sphere(8),
  muon: sphere(10),
  proton: sphere(12),
  neutron: sphere(14),
};

export const particlePalettes: Record<keyof typeof particleArt, string[]> = {
  electron: ['', '#296175', '#499ab0', '#91dceb', '#e4fcff'],
  electronSurge: ['', '#94702e', '#e0b14f', '#ffe49b', '#ffffe4'],
  quark: ['', '#54383f', '#865460', '#bf7f86', '#e5b0ad'],
  muon: ['', '#443853', '#726083', '#ad99bc', '#d7c9df'],
  proton: ['', '#554b32', '#938055', '#c4ae7d', '#e8d9ad'],
  neutron: ['', '#34495a', '#56758b', '#88a5bb', '#c0d4df'],
};
