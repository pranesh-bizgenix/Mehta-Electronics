import { conflict, forbidden, notFound, validationFailed } from '../../core/errors.js';
import { s,validate } from '../../core/schema.js';
import { hashPassword,validatePassword } from '../../security.js';
import { provisioningWarnings } from './reviewer-eligibility.js';

const DEPARTMENTS = ['SALES', 'OPERATIONS', 'ACCOUNTS', 'CUSTOMER_SUPPORT'];
const createBody=s.object({name:s.string({min:1,max:200}),email:s.email(),phone:s.string({max:50}).optional().nullable(),
  role:s.string({min:2,max:40,upper:true}),ownerUserId:s.id(),backupUserId:s.id().optional().nullable(),department:s.enum(DEPARTMENTS).optional().nullable(),
  password:s.string({min:12,max:128,trim:false}),reason:s.reason()});
const editBody=s.object({name:s.string({min:1,max:200}).optional(),email:s.email().optional(),phone:s.string({max:50}).optional().nullable(),
  role:s.string({max:40,upper:true}).optional(),status:s.enum(['ACTIVE','INACTIVE','LOCKED']).optional(),department:s.enum(DEPARTMENTS).optional().nullable(),
  onLeave:s.bool().optional(),ownerUserId:s.id().optional().nullable(),managerUserId:s.id().optional().nullable(),backupUserId:s.id().optional().nullable(),
  reassignToBackup:s.bool().default(false),reason:s.reason()});
const previewBody=s.object({userId:s.id().optional(),name:s.string({max:200}).optional(),role:s.string({max:40,upper:true}).optional(),status:s.enum(['ACTIVE','INACTIVE','LOCKED']).optional(),onLeave:s.bool().optional()});

export class UserAdminRepository {
  constructor(db) { this.db = db; }
  async list() {
    return this.db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.role,u.status,u.department,u.on_leave,u.must_change_password,u.locked_until,u.backup_user_id,b.name AS backup_name,u.manager_user_id,m.name AS manager_name,
      (m2.enabled_at IS NOT NULL) AS mfa_enabled,u.updated_at FROM users u LEFT JOIN users b ON b.id=u.backup_user_id LEFT JOIN users m ON m.id=u.manager_user_id
      LEFT JOIN user_mfa m2 ON m2.user_id=u.id ORDER BY u.name`).all();
  }
  async get(id) { return this.db.prepare('SELECT id,name,email,phone,role,status,department,on_leave,must_change_password,backup_user_id,manager_user_id FROM users WHERE id=?').get(id); }
  async lock() { await this.db.prepare('SELECT pg_advisory_xact_lock(73429923)').get(); }
  async create(f) { return (await this.db.prepare('INSERT INTO users(name,email,phone,role,department,manager_user_id,backup_user_id,password_hash,must_change_password) VALUES(?,?,?,?,?,?,?,?,1) RETURNING id').get(f.name,f.email,f.phone??null,f.role,f.department??null,f.ownerUserId,f.backupUserId??null,f.passwordHash)).id; }
  async revokeSessions(id) { await this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); }
  async update(id, f) {
    await this.db.prepare('UPDATE users SET name=?,email=?,phone=?,role=?,status=?,department=?,on_leave=?,backup_user_id=?,manager_user_id=?,updated_at=now() WHERE id=?')
      .run(f.name,f.email,f.phone,f.role, f.status, f.department, f.on_leave, f.backup_user_id, f.manager_user_id, id);
  }
  async owners() { return Number((await this.db.prepare("SELECT count(*) AS n FROM users WHERE role='OWNER' AND status='ACTIVE'").get()).n); }
}

/** Users & Roles (S-24): role, department label, backup, manager, leave; one-action reassignment. */
export class UserAdminService {
  constructor({ repository, access, work, tasks, transactions, audit }) { Object.assign(this, { repository, access, work, tasks, transactions, audit }); }

  async list(user) {
    this.access.require(user, 'users.read');
    return (await this.repository.list()).map((u) => ({
      id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, status: u.status, department: u.department, onLeave: u.on_leave,
      backupUserId: u.backup_user_id, backup: u.backup_name, managerUserId: u.manager_user_id, manager: u.manager_name, mfaEnabled: u.mfa_enabled,
      ownerUserId:u.manager_user_id,owner:u.manager_name,mustChangePassword:Boolean(u.must_change_password),
      mfaRequired: this.access.requiresMfa(u.role)
    }));
  }

  async availability(actor,body) {
    this.access.require(actor,'users.read');
    const users=await this.repository.list();
    if(body) {
      const b=validate(previewBody,body);
      if(b.role&&!this.access.roleExists(b.role))throw validationFailed('Select an active role.');
      if(b.userId&&!users.some(u=>u.id===b.userId))throw notFound('User not found.');
      const patch={...(b.name?{name:b.name}:{}),...(b.role?{role:b.role}:{}),...(b.status?{status:b.status}:{}),...(b.onLeave!==undefined?{on_leave:b.onLeave}:{})};
      if(b.userId)Object.assign(users.find(u=>u.id===b.userId),patch);
      else users.push({id:-1,name:b.name||'New staff member',role:b.role||'EXECUTIVE',status:'ACTIVE',on_leave:false,must_change_password:1,...patch});
    }
    return provisioningWarnings(users,this.access);
  }

  async validateOwners(ownerId,backupId,id) {
    if(ownerId!=null&&backupId!=null&&ownerId===backupId)throw validationFailed('Owner and backup owner must be different people.');
    for(const ref of [ownerId,backupId])if(ref!=null){
      if(ref===id)throw validationFailed('A staff member cannot be their own owner or backup.');
      const person=await this.repository.get(ref);
      if(!person||person.status!=='ACTIVE'||person.on_leave||!this.access.roleExists(person.role))throw validationFailed('Choose active owners and backups who are not on leave.');
    }
  }

  async create(actor,input) {
    this.access.require(actor,'users.create');
    const body=validate(createBody,input),passwordError=validatePassword(body.password);
    if(passwordError)throw validationFailed(passwordError);
    if(!this.access.roleExists(body.role))throw validationFailed('Select an active role.');
    try { return await this.transactions.run(actor,body.reason,async()=>{
      await this.repository.lock();
      const currentActor=await this.repository.get(actor.id);
      if(!currentActor||currentActor.status!=='ACTIVE')throw forbidden();
      this.access.require(currentActor,'users.create');
      await this.validateOwners(body.ownerUserId,body.backupUserId);
      const id=await this.repository.create({...body,passwordHash:hashPassword(body.password)});
      const created=await this.repository.get(id);
      await this.audit.record({actorId:actor.id,entity:'USER',recordId:id,action:'CREATE',newValue:created,reason:body.reason});
      return (await this.list(actor)).find(u=>u.id===id);
    }); } catch(error) { if(error.code==='23505')throw conflict('A user with that email already exists.');throw error; }
  }

  async update(actor, id, body) {
    this.access.require(actor, 'users.update');
    id=validate(s.id(),id);
    body=validate(editBody,body);
    if(body.ownerUserId!==undefined&&body.managerUserId!==undefined&&body.ownerUserId!==body.managerUserId)throw validationFailed('Owner and manager refer to the same reporting field; provide matching values.');
    try {return await this.transactions.run(actor, body.reason, async () => {
      await this.repository.lock();
      const currentActor=await this.repository.get(actor.id);
      if(!currentActor||currentActor.status!=='ACTIVE')throw forbidden();
      this.access.require(currentActor,'users.update');
      const old = await this.repository.get(id);
      if (!old) throw notFound('User not found.');
      const next = {
        name:body.name??old.name,email:body.email??old.email,phone:body.phone===undefined?old.phone:body.phone,
        role: body.role ?? old.role, status: body.status ?? old.status, department: body.department === undefined ? old.department : body.department,
        on_leave: body.onLeave ?? old.on_leave, backup_user_id: body.backupUserId === undefined ? old.backup_user_id : body.backupUserId,
        manager_user_id: body.ownerUserId!==undefined?body.ownerUserId:body.managerUserId===undefined?old.manager_user_id:body.managerUserId
      };
      if (!this.access.roleExists(next.role)) throw validationFailed('Select an active role.');
      if(body.ownerUserId!==undefined||body.managerUserId!==undefined||body.backupUserId!==undefined)await this.validateOwners(next.manager_user_id,next.backup_user_id,id);
      if(id===actor.id&&next.status!=='ACTIVE')throw validationFailed('You cannot deactivate your own account.');
      if (old.role === 'OWNER' && (next.role !== 'OWNER' || next.status !== 'ACTIVE') && await this.repository.owners() <= 1) throw validationFailed('The last active owner cannot be demoted or deactivated.');
      await this.repository.update(id, next);
      if(next.status!=='ACTIVE'||next.role!==old.role)await this.repository.revokeSessions(id);
      await this.audit.record({ actorId: actor.id, entity: 'USER', recordId: id, action: 'UPDATE_ACCESS', oldValue: old, newValue: next, reason: body.reason });
      let reassigned = null;
      if (body.reassignToBackup) reassigned = await this.reassignAll(actor, id, body.reason);
      return { user: (await this.list(actor)).find((u) => u.id === id), reassigned };
    });}catch(error){if(error.code==='23505')throw conflict('A user with that email already exists.');throw error;}
  }

  async reassignAll(actor, id, reason) {
    this.access.require(actor, 'work.reassign');
    id=validate(s.id(),id);
    return this.transactions.run(actor, reason, async () => {
      const work = await this.work.reassignAllToBackup(actor, id, reason);
      const tasks = await this.tasks.reassignAllToBackup(actor, id, reason);
      return { workItems: work, tasks };
    });
  }
}

export class UserAdminController {
  constructor({ userAdmin, notifications }) { this.userAdmin = userAdmin; this.notifications = notifications; }
  routes() {
    const u = this.userAdmin;
    return [
      { method: 'GET', path: '/api/v1/users', permission: 'users.read', handler: async ({ user }) => ({ data: await u.list(user) }) },
      { method:'POST',path:'/api/v1/users',permission:'users.create',body:createBody,idempotency:'optional',handler:async({user,body})=>({status:201,data:await u.create(user,body)}) },
      { method:'GET',path:'/api/v1/users/provisioning',permission:'users.read',handler:async({user})=>({data:await u.availability(user)}) },
      { method:'POST',path:'/api/v1/users/provisioning-preview',permission:'users.read',body:previewBody,handler:async({user,body})=>({data:await u.availability(user,body)}) },
      {
        method: 'PATCH', path: '/api/v1/users/:id', permission: 'users.update',
        body: editBody,
        handler: async ({ user, params, body }) => ({ data: await u.update(user, Number(params.id), body) })
      },
      {
        method: 'POST', path: '/api/v1/users/:id/reassign', permission: 'work.reassign', idempotency: 'optional',
        body: s.object({ reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await u.reassignAll(user, Number(params.id), body.reason) })
      },
      {
        method: 'GET', path: '/api/v1/notifications', permission: 'authenticated',
        query: s.object({ unreadOnly: s.bool().default(false) }),
        handler: async ({ user, query }) => ({ data: await this.notifications.mine(user, query) })
      },
      { method: 'POST', path: '/api/v1/notifications/:id/read', permission: 'authenticated', body: s.object({}), handler: async ({ user, params }) => ({ data: await this.notifications.markRead(user, params.id) }) }
    ];
  }
}
