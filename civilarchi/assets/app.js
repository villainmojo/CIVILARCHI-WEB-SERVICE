(function(){
  const elStatus = document.getElementById('status');
  const elBuild = document.getElementById('build');

  const build = {
    deployedAt: new Date().toISOString(),
    path: location.pathname,
  };

  if(elBuild) elBuild.textContent = build.deployedAt;
  if(elStatus) elStatus.textContent = '정상 작동 중';
})();
