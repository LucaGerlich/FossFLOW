import type { Browser, TestApp } from './app.js';

export interface Person {
  browser: Browser;
  id: string;
}

const tokenOf = (url: string) => url.split('/invite/')[1] ?? '';

/** Invites someone (password `<Name>-pass-1A`) and signs them in through the link. */
export async function joinAs(
  t: TestApp,
  inviter: Browser,
  name: string,
  instanceRole: 'global:member' | 'global:admin' = 'global:member'
): Promise<Person> {
  const invite = await inviter.post('/api/invitations', {
    email: `${name.toLowerCase()}@example.com`,
    instanceRole
  });
  const browser = t.browser();
  await browser.post(`/api/invitations/accept/${tokenOf(invite.body.url)}`, {
    name,
    password: `${name}-pass-1A`
  });
  const session = await browser.get('/api/auth/get-session');
  return { browser, id: session.body.user.id };
}

/** The id of the signed-in person's personal project. */
export const personalOf = async (browser: Browser): Promise<string> =>
  ((await browser.get('/api/projects')).body as { id: string; type: string }[]).find(
    (project) => project.type === 'personal'
  )?.id ?? '';
