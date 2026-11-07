/** @typedef {import('./index.js').ProjectMetrics} ProjectMetrics */
/** @returns {ProjectMetrics[]} 독립적인 복사본. 실제 계정·저장소·토큰을 포함하지 않는다. */
export function sampleMetrics() {
  return [
    {projectId:'sample-one',commits30d:0,activityRatio:0,openPRs:0,openIssues:0,ci:'none',sync:{mode:'polling',status:'ok',lastSuccessfulSyncAt:'2026-01-01T00:00:00Z'}},
    {projectId:'sample-two',commits30d:9,activityRatio:0.5,openPRs:2,openIssues:3,ci:'running',ciBranch:'main',sync:{mode:'polling',status:'syncing'},progress:{prd:50,bp:25,mvp:40}},
    {projectId:'sample-three',commits30d:99,activityRatio:1,openPRs:4,openIssues:6,ci:'failing',ciBranch:'main',sync:{mode:'polling',status:'stale',lastSuccessfulSyncAt:'2026-01-01T00:00:00Z',error:'budget'}},
  ];
}
