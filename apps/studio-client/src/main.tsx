import { createRoot } from 'react-dom/client'

function App() {
  return <main>Loom Studio client placeholder</main>
}

const root = document.getElementById('root')

if (root) {
  createRoot(root).render(<App />)
}
