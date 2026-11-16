import {randomToken,tokenDigest} from './security.js';
import {writeAudit} from './db.js';

const loopback = value => ['127.0.0.1','::1','::ffff:127.0.0.1','localhost'].includes(value);
/** Explicit local review mode: never trust forwarded addresses or arbitrary Host headers. */
export function localAccessAllowed(req,config) {
  if (config.isProduction || process.env.NODE_ENV === 'production' || !config.localReviewAccess || !loopback(config.host) || !loopback(req.socket?.remoteAddress)) return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (!['localhost','127.0.0.1','[::1]'].includes(host.hostname) || Number(host.port || 80)!==Number(config.port)) return false;
    if (req.headers['sec-fetch-site']==='cross-site') return false;
    if (req.headers.origin && new URL(req.headers.origin).host!==host.host) return false;
    return true;
  } catch { return false; }
}

export async function localReviewUser(db,req,res,config,user) {
  if (!localAccessAllowed(req,config)) return user;
  if (user?.role==='OWNER') return {...user,must_change_password:0,mfa_enabled:false,mfa_verified_at:new Date().toISOString()};
  if (req.method!=='GET' || req.url.split('?')[0]!=='/api/auth/me') return user;
  const owner=await db.prepare("SELECT id FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY id LIMIT 1").get();
  if (!owner) throw Object.assign(new Error('Local review requires an existing active Owner account. No account was created.'),{status:403});
  const token=randomToken(),csrf=randomToken();
  await db.prepare(`INSERT INTO sessions(user_id,token_hash,csrf_token,ip_address,user_agent,expires_at) VALUES(?,?,?,?,?,(CURRENT_TIMESTAMP + (?::integer * INTERVAL '1 minute')))`)
    .run(owner.id,tokenDigest(token),csrf,req.socket.remoteAddress,'ControlDesk localhost review',String(config.sessionTtlMinutes));
  await writeAudit(db,{userId:owner.id,action:'LOCAL_REVIEW_SESSION',entity:'user',recordId:owner.id,reason:'Owner-authorized login-free localhost review',ipAddress:req.socket.remoteAddress});
  res.setHeader('set-cookie',`crm_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.sessionTtlMinutes*60}`);
  req.headers.cookie=`crm_session=${encodeURIComponent(token)}`;
  return null; // Caller reloads the newly created normal session.
}
