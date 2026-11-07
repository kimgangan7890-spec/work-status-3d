import fs from 'node:fs/promises';
import path from 'node:path';
import { filePathOf } from '../shared/projects.js';
import { githubError } from './github-budget.js';

// 기존 사무동의 status.json만 읽는다. 지시함 접근이나 실행 경로는 없다.
export function createAgentSource({ dataDir, projects }) {
  return async function load(project, remote) {
    const config = projects().find(p => p.id === project.projectId);
    if (!config) return null;
    try {
      if (config.repo) {
        const resource = `/repos/${config.repo}/contents/${filePathOf(config, 'status.json').split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(config.branch || 'main')}`;
        return await remote(resource);
      }
      const file = path.join(dataDir, 'status.json');
      if ((await fs.stat(file)).size > 1_000_000) throw githubError('NETWORK');
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (e) { if (e.code === 'NOT_FOUND' || e.code === 'ENOENT' || e instanceof SyntaxError) return null; throw e; }
  };
}
