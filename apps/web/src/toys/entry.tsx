import { render } from 'preact';
import '../styles.css';
import { ToysApp } from './ToysApp.js';

render(<ToysApp />, document.getElementById('app')!);
