import { createRoot } from 'react-dom/client';
import { version } from '../package.json';

function Title() {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
      <div style={{ textAlign: 'center' }}>
        <h1>SINGULARITY</h1>
        <p>v{version}</p>
      </div>
    </main>
  );
}

document.body.style.cssText = 'margin:0;background:#080a0e;color:#f1fcff;font-family:monospace';
createRoot(document.getElementById('root')!).render(<Title />);
