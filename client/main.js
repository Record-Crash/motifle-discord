import { mount } from 'svelte';
import App from './src/App.svelte';
import './style.css';

const app = mount(App, { target: document.getElementById('app') });

export default app;
