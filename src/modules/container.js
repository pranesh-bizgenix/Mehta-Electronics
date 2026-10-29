// Composition root for the layered modules: builds repositories, services and
// controllers with constructor injection, and exposes route definitions and
// scheduler jobs. Later slices register their modules here.

import { AuditRepository, SecretBox, SystemClock, TransactionRunner } from '../core/runtime.js';
import { Scheduler } from '../core/scheduler.js';
import { IdempotencyRepository } from '../core/http.js';
import { AccessRepository } from './access/access-repository.js';
import { AccessService } from './access/access-service.js';
import { AccessController } from './access/access-controller.js';
import { Totp } from './mfa/totp.js';
import { MfaRepository } from './mfa/mfa-repository.js';
import { MfaService } from './mfa/mfa-service.js';
import { MfaController } from './mfa/mfa-controller.js';
import { F1_RULES, RuleRegistry } from './rules/rule-definitions.js';
import { RuleRepository } from './rules/rule-repository.js';
import { RuleService } from './rules/rule-service.js';
import { RuleController } from './rules/rule-controller.js';
import { QuotationPolicyFloorSource, marginFloorDefinition } from './rules/quotation-policy-source.js';
import { NotificationRepository, NotificationService } from './notifications/notification-service.js';
import { WorkRepository } from './work/work-repository.js';
import { WorkService } from './work/work-service.js';
import { WorkController } from './work/work-controller.js';
import { RecordSyncJob, RecordSyncRepository } from './work/record-sync.js';
import { AutomationController, AutomationRepository, AutomationService } from './automation/automation-service.js';
import { ExceptionRepository, ExceptionService } from './exceptions/exception-service.js';
import { ExceptionController } from './exceptions/exception-controller.js';
import { OutboundRepository, ContactEmailDirectory } from './outbound/outbound-repository.js';
import { OutboundService } from './outbound/outbound-service.js';
import { OutboundController } from './outbound/outbound-controller.js';
import { ApprovalGate, ChecklistGate, ManualResponseGate, RegisteredEmailGate, VerifiedRecordGate, WorkflowSwitchGate } from './outbound/gates.js';
import { TaskRepository } from './tasks/task-repository.js';
import { TaskService } from './tasks/task-service.js';
import { TaskController } from './tasks/task-controller.js';
import { AuditController, AuditQueryRepository, AuditService } from './admin/audit-service.js';
import { UserAdminController, UserAdminRepository, UserAdminService } from './admin/user-admin-service.js';

export function createModules({ db, config, clock = new SystemClock(), outboundMailer, logger = console }) {
  const transactions = new TransactionRunner(db);
  const audit = new AuditRepository(db);

  const access = new AccessService({ repository: new AccessRepository(db), transactions, audit, mfaEnabled: Boolean(config.mfaEnabled) });
  const registry = new RuleRegistry(F1_RULES).register(marginFloorDefinition(new QuotationPolicyFloorSource({ db })));
  const rules = new RuleService({ registry, repository: new RuleRepository(db), transactions, audit, access });
  const automation = new AutomationService({ repository: new AutomationRepository(db), transactions, audit, access });
  const notifications = new NotificationService({ repository: new NotificationRepository(db) });
  const mfa = new MfaService({ repository: new MfaRepository(db), totp: new Totp(), secretBox: new SecretBox(config.appEncryptionKey), clock, transactions, audit, access });
  const work = new WorkService({ repository: new WorkRepository(db), rules, automation, notifications, transactions, audit, access, clock });
  const exceptions = new ExceptionService({ repository: new ExceptionRepository(db), transactions, audit, access });
  exceptions.registerHandler('BACKDATE', { onApproved: (actor, c) => work.applyBackdate(actor, c) });
  const tasks = new TaskService({ repository: new TaskRepository(db), work, rules, automation, notifications, transactions, audit, access, clock });
  const outboundRepository = new OutboundRepository(db);
  const gates = [new VerifiedRecordGate(), new RegisteredEmailGate(), new ManualResponseGate(), new WorkflowSwitchGate({ automation }), new ChecklistGate(), new ApprovalGate()];
  const outbound = new OutboundService({ repository: outboundRepository, gates, emailDirectory: new ContactEmailDirectory(db), mailer: outboundMailer, transactions, audit, access });
  const auditQuery = new AuditService({ repository: new AuditQueryRepository(db), access });
  const userAdmin = new UserAdminService({ repository: new UserAdminRepository(db), access, work, tasks, transactions, audit });

  const controllers = [
    new AccessController({ access }), new MfaController({ mfa }), new RuleController({ rules }), new WorkController({ work }),
    new AutomationController({ automation }), new ExceptionController({ exceptions }), new OutboundController({ outbound }),
    new TaskController({ tasks }), new AuditController({ auditQuery }), new UserAdminController({ userAdmin, notifications })
  ];

  const scheduler = new Scheduler({ db, logger })
    .register({ name: 'sla_escalation', intervalMs: 60_000, run: () => work.escalateOverdue() })
    .register({ name: 'task_reminders', intervalMs: 60_000, run: () => tasks.sendReminders() })
    .register(new RecordSyncJob({ repository: new RecordSyncRepository(db), work }));

  let loading = null;
  return {
    services: { access, rules, automation, notifications, mfa, work, exceptions, tasks, outbound, auditQuery, userAdmin },
    transactions, audit, scheduler, clock,
    idempotency: new IdempotencyRepository(db),
    routeDefinitions: () => controllers.flatMap((c) => c.routes()),
    /** Loads the access matrix once and installs it as the permission provider. */
    async ready() {
      if (!loading) loading = access.load().then(() => access.install());
      return loading;
    }
  };
}
