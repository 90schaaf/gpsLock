import { render } from 'preact';
import '../styles.css';
import '../lib/iframe-height.js';
import { createBackend } from '../lib/bootstrap.js';
import { MainApp } from './MainApp.js';

const { backend, mock } = createBackend();
render(<MainApp backend={backend} mock={mock} />, document.getElementById('app')!);
