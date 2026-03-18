const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

interface MakeHeadersOptions {
  authToken: string;
  ct0: string;
  bearerToken: string;
  userAgent?: string;
}

type TwitterRequestHeaders = Record<string, string>;

function makeHeaders({
  authToken,
  ct0,
  bearerToken,
  userAgent = DEFAULT_USER_AGENT,
}: MakeHeadersOptions): TwitterRequestHeaders {
  if (!authToken) {
    throw new Error('`--auth-token` is required.');
  }
  if (!ct0) {
    throw new Error('`--ct0` is required.');
  }
  if (!bearerToken) {
    throw new Error('Bearer token is missing. Pass `--bearer` or set TWITTER_BEARER.');
  }

  const cookieString = `auth_token=${authToken}; ct0=${ct0};`;

  return {
    Origin: 'https://x.com',
    Referer: 'https://x.com/',
    'X-Csrf-Token': ct0,
    Cookie: cookieString,
    Authorization: `Bearer ${bearerToken}`,
    'User-Agent': userAgent,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Content-Type': 'application/json',
    'X-Twitter-Active-User': 'yes',
    'X-Twitter-Auth-Type': 'OAuth2Session',
    'X-Twitter-Client-Language': 'ko',
  };
}

export { DEFAULT_USER_AGENT, makeHeaders };
