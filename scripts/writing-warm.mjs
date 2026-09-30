const base = process.env.BASE_URL ?? 'https://quiescent-writing-test.ncrmro.workers.dev';
const login = await fetch(`${base}/api/auth/sign-in/email`, {
  method: 'POST', headers: {'Content-Type':'application/json', Origin:base},
  body: JSON.stringify({email:'writer@quiescent.test',password:process.env.WRITING_TEST_PASSWORD ?? 'quiescent-demo'}),
});
if (!login.ok) throw new Error(`Sign-in failed: ${login.status}`);
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
try {
  const response = await fetch(`${base}/api/writing/cache/refresh`, {method:'POST', headers:{Cookie:cookie,Origin:base}});
  if (!response.ok) throw new Error(`Cache warming failed: ${response.status}`);
  console.log('Published and author caches are ready.');
} finally {
  await fetch(`${base}/api/auth/sign-out`, {method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:'{}'});
}
