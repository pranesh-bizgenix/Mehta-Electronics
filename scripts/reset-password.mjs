import { getConfig } from '../src/config.js';
import { openDatabase, writeAudit } from '../src/db.js';
import { hashPassword, validatePassword } from '../src/security.js';

const email=String(process.argv[2]||'').trim().toLowerCase();
if(!email){console.error('Usage: npm run reset-password -- user@example.com');process.exit(1)}
if(!process.stdin.isTTY||typeof process.stdin.setRawMode!=='function'){console.error('Run this command in an interactive PowerShell window.');process.exit(1)}

function hiddenPrompt(label){
  return new Promise((resolve,reject)=>{
    let value='';process.stdout.write(label);process.stdin.setRawMode(true);process.stdin.resume();
    const finish=()=>{process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',onData);process.stdout.write('\n')};
    const onData=chunk=>{for(const char of chunk.toString('utf8')){if(char==='\u0003'){finish();reject(new Error('Password reset cancelled.'));return}if(char==='\r'||char==='\n'){finish();resolve(value);return}if(char==='\u0008'||char==='\u007f'){value=value.slice(0,-1);continue}value+=char}};
    process.stdin.on('data',onData);
  });
}

try{
  const password=await hiddenPrompt('New password: ');const confirmation=await hiddenPrompt('Confirm password: ');
  if(password!==confirmation)throw new Error('Passwords do not match.');
  const validation=validatePassword(password);if(validation)throw new Error(validation);
  const db=openDatabase(getConfig());
  try{
    const user=db.prepare('SELECT id,email FROM users WHERE email=? COLLATE NOCASE').get(email);if(!user)throw new Error(`No account exists for ${email}.`);
    db.exec('BEGIN IMMEDIATE');
    try{db.prepare('UPDATE users SET password_hash=?,must_change_password=0,failed_login_count=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashPassword(password),user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);writeAudit(db,{userId:user.id,entity:'USER',recordId:user.id,action:'PASSWORD_RECOVERY'});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error}
  }finally{db.close()}
  console.log(`Password reset completed for ${email}.`);
}catch(error){console.error(error.message);process.exit(1)}
