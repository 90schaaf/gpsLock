import { render } from 'preact';
import '../styles.css';
import { CHASTER_ORIGINS, createBackend } from '../lib/bootstrap.js';
import { ConfigBridge } from '../lib/config-bridge.js';
import { ConfigApp } from './ConfigApp.js';

const { backend } = createBackend();
const bridge = new ConfigBridge(window as unknown as ConstructorParameters<typeof ConfigBridge>[0], CHASTER_ORIGINS);
render(<ConfigApp backend={backend} bridge={bridge} />, document.getElementById('app')!);
