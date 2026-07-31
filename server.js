const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');
const HOST = process.env.HOST || '0.0.0.0';

// MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Ensure data directory
const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadTasks() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return [];
}

function saveTasksSync(tasks) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf-8');
  fs.renameSync(tmp, DATA_FILE);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (e) { resolve({}); }
    });
  });
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end('Not Found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method.toUpperCase();

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes
  if (url.pathname === '/api/tasks') {
    if (method === 'GET') {
      const tasks = loadTasks();
      return jsonResponse(res, 200, { success: true, data: tasks, timestamp: Date.now() });
    }
    if (method === 'POST') {
      const body = await parseBody(req);
      const title = (body.title || '').trim();
      if (!title) return jsonResponse(res, 400, { success: false, error: '任务标题不能为空' });
      const tasks = loadTasks();
      const task = {
        id: Date.now(),
        title,
        description: body.description || '',
        progress: 0,
        pinned: false,
        summaries: [],
        createdAt: new Date().toISOString()
      };
      tasks.unshift(task);
      saveTasksSync(tasks);
      return jsonResponse(res, 200, { success: true, data: task });
    }
  }

  // /api/tasks/:id
  const taskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (taskMatch) {
    const id = parseInt(taskMatch[1]);
    const tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === id);

    if (method === 'GET') {
      if (idx === -1) return jsonResponse(res, 404, { success: false, error: '任务不存在' });
      return jsonResponse(res, 200, { success: true, data: tasks[idx] });
    }

    if (method === 'PUT') {
      if (idx === -1) return jsonResponse(res, 404, { success: false, error: '任务不存在' });
      const body = await parseBody(req);
      const allowed = ['title', 'description', 'progress', 'pinned', 'summaries'];
      allowed.forEach(key => {
        if (body[key] !== undefined) tasks[idx][key] = body[key];
      });
      saveTasksSync(tasks);
      return jsonResponse(res, 200, { success: true, data: tasks[idx] });
    }

    if (method === 'DELETE') {
      if (idx === -1) return jsonResponse(res, 404, { success: false, error: '任务不存在' });
      tasks.splice(idx, 1);
      saveTasksSync(tasks);
      return jsonResponse(res, 200, { success: true });
    }
  }

  // /api/tasks/:id/pin
  const pinMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/pin$/);
  if (pinMatch && method === 'PUT') {
    const id = parseInt(pinMatch[1]);
    const tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return jsonResponse(res, 404, { success: false, error: '任务不存在' });
    tasks[idx].pinned = !tasks[idx].pinned;
    saveTasksSync(tasks);
    return jsonResponse(res, 200, { success: true, data: tasks[idx] });
  }

  // /api/tasks/:id/summaries
  const summaryMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/summaries$/);
  if (summaryMatch) {
    const id = parseInt(summaryMatch[1]);
    const tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return jsonResponse(res, 404, { success: false, error: '任务不存在' });

    if (method === 'POST') {
      const body = await parseBody(req);
      const content = (body.content || '').trim();
      if (!content) return jsonResponse(res, 400, { success: false, error: '总结内容不能为空' });
      const summary = { id: Date.now(), content, date: new Date().toISOString() };
      if (!tasks[idx].summaries) tasks[idx].summaries = [];
      tasks[idx].summaries.push(summary);
      saveTasksSync(tasks);
      return jsonResponse(res, 200, { success: true, data: summary });
    }
  }

  // /api/tasks/:id/summaries/:sid
  const summaryDelMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/summaries\/(\d+)$/);
  if (summaryDelMatch && method === 'DELETE') {
    const id = parseInt(summaryDelMatch[1]);
    const sid = parseInt(summaryDelMatch[2]);
    const tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return jsonResponse(res, 404, { success: false, error: '任务不存在' });
    tasks[idx].summaries = (tasks[idx].summaries || []).filter(s => s.id !== sid);
    saveTasksSync(tasks);
    return jsonResponse(res, 200, { success: true });
  }

  // /api/sync
  if (url.pathname === '/api/sync' && method === 'PUT') {
    const body = await parseBody(req);
    if (!Array.isArray(body.tasks)) return jsonResponse(res, 400, { success: false, error: '数据格式错误' });
    saveTasksSync(body.tasks);
    return jsonResponse(res, 200, { success: true, data: body.tasks });
  }

  // Static files
  let filePath = path.join(__dirname, url.pathname === '/' ? 'task-workbench.html' : url.pathname);
  // Security: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  serveStatic(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log(`张维的天马世界 服务已启动: http://localhost:${PORT}`);
  console.log(`局域网访问: http://<本机IP>:${PORT}`);
});
