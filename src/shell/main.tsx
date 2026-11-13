import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App.tsx';
import { startSessionStream } from './session-stream.ts';

// 在任何会话打开前就订阅输出，否则首个 prompt 会在 IPC 到达时无人接收而丢失。
startSessionStream();

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 容器');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
