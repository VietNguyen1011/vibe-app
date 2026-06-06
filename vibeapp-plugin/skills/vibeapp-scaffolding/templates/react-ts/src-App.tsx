import { useEffect, useState } from 'react';

export default function App() {
  const [data, setData] = useState<unknown>(null);
  useEffect(() => { fetch('/api/hello').then((r) => r.json()).then(setData); }, []);
  return (
    <main>
      <h1>VibeApp</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
