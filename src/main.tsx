import { createRoot } from 'react-dom/client';
import App from './App';
import StyleGuide from './views/StyleGuide';
import './styles.css';

// A hidden dev reference for the design tokens, reachable at #styleguide.
const showStyleGuide = window.location.hash === '#styleguide';

createRoot(document.getElementById('root')!).render(showStyleGuide ? <StyleGuide /> : <App />);
