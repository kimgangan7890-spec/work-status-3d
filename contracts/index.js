// M0 v1.0.1 공통 계약. 이 파일에는 인증정보나 서버 전용 모듈을 넣지 않는다.
/** @typedef {{projectId:string, github?:{repoId:number, fullName:string, defaultBranch:string, isPrivate:boolean}}} ProjectRef */
/** @typedef {'pat'|'device_flow'} AuthMethod */
/** @typedef {'shared_app'|'manifest_app'} AppSetup */
/** @typedef {{getToken:()=>Promise<string>}} AuthService 서버 내부 전용. 브라우저 API에서 토큰을 반환하지 않는다. */
/** @typedef {{connected:boolean,method?:AuthMethod,login?:string,scopesOk:boolean,error?:'expired'|'revoked'|'rate_limited'}} ConnectionInfo */
/** @typedef {'commit'|'pr_opened'|'pr_closed'|'pr_merged'|'issue_opened'|'issue_closed'|'ci_changed'|'agent_working'|'agent_idle'|'agent_needs_approval'} WorkEventKind */
/** @typedef {{eventId:string,source:'github'|'agent',agent?:'grok'|'gpt'|'claude'|'sonnet',projectId:string,kind:WorkEventKind,observedAt:string,meta?:Record<string,unknown>}} WorkEvent */
/** @typedef {'passing'|'failing'|'pending'|'running'|'unknown'|'none'} CiStatus */
/** @typedef {{projectId:string,commits30d:number,activityRatio:number,openPRs:number,openIssues:number,ci:CiStatus,ciBranch?:string,sync:{mode:'polling'|'webhook',status:'ok'|'syncing'|'stale'|'error',lastSuccessfulSyncAt?:string,error?:'auth'|'not_found'|'rate_limited'|'budget'|'network'},progress?:{prd?:number,bp?:number,mvp?:number}}} ProjectMetrics */
/** @typedef {'relay'|'activity_sync'|'discovery'} BudgetPurpose */
/** @typedef {{floors:number,litWindows:number,roof:'normal'|'alert'|'busy',dim:boolean}} BuildingLook */
export const CONTRACT_VERSION = '1.0.1';
export const BUDGET_PRIORITY = Object.freeze(['relay', 'activity_sync', 'discovery']);
export const CI_STATES = Object.freeze(['passing', 'failing', 'pending', 'running', 'unknown', 'none']);

/** @typedef {{repoId:number,fullName:string,defaultBranch:string,isPrivate:boolean}} RepoRef 저장소 선택 API. ProjectRef.github와 같은 필드. */
