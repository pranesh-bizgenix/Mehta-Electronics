// Outbound gates (strategy pattern). Each gate inspects a draft context and
// returns { gate, passed, message }. A new rule is added as a new gate class.
// Order follows the client plan: switch ON -> checklist ticked -> draft
// approved, plus record/email checks that must hold for any send.

/** @interface OutboundGate { name: string; check(ctx): Promise<{passed: boolean, message: string}> } */

export class VerifiedRecordGate {
  get name() { return 'VERIFIED_RECORD'; }
  async check({ customer }) {
    if (!customer) return { passed: false, message: 'The draft is not linked to a verified CRM customer record.' };
    if (customer.status !== 'ACTIVE') return { passed: false, message: `Customer record is ${customer.status}.` };
    if (customer.approvalState && customer.approvalState !== 'APPROVED') return { passed: false, message: 'Customer is pending approval.' };
    return { passed: true, message: 'Linked to an active CRM customer.' };
  }
}

export class RegisteredEmailGate {
  get name() { return 'REGISTERED_EMAIL'; }
  async check({ draft, registeredEmails }) {
    const recipients = draft.recipients;
    if (!recipients.length) return { passed: false, message: 'The draft has no recipient.' };
    if (!registeredEmails.length) return { passed: false, message: 'The customer has no registered email address.' };
    const unknown = recipients.filter((r) => !registeredEmails.includes(r));
    return unknown.length ? { passed: false, message: `Not a registered customer email: ${unknown.join(', ')}.` } : { passed: true, message: 'All recipients are registered customer emails.' };
  }
}

export class BankRecipientGate {
  constructor({ isBankAddress }) { this.isBankAddress = isBankAddress; }
  get name() { return 'NOT_BANK'; }
  async check({ draft }) {
    const bank = [];
    for (const r of draft.recipients) if (await this.isBankAddress(r)) bank.push(r);
    return bank.length ? { passed: false, message: `Bank addresses are never replied to: ${bank.join(', ')}.` } : { passed: true, message: 'No bank recipients.' };
  }
}

export class ManualResponseGate {
  get name() { return 'MANUAL_RESPONSE_LIST'; }
  async check({ manualResponse }) {
    return manualResponse ? { passed: false, message: `On the manual-response list: ${manualResponse}.` } : { passed: true, message: 'Not on the manual-response list.' };
  }
}

export class WorkflowSwitchGate {
  constructor({ automation }) { this.automation = automation; }
  get name() { return 'WORKFLOW_SWITCH'; }
  async check({ draft }) {
    if (!draft.workflowKey) return { passed: true, message: 'Manually written message; no automation workflow involved.' };
    return await this.automation.isEnabled(draft.workflowKey)
      ? { passed: true, message: `Workflow ${draft.workflowKey} is ON.` }
      : { passed: false, message: `Workflow ${draft.workflowKey} is OFF. Only the owner can turn it ON.` };
  }
}

export class ChecklistGate {
  get name() { return 'CUSTOMER_CHECKLIST'; }
  async check({ draft, checklistTicked }) {
    if (!draft.category) return { passed: false, message: 'The draft has no message category.' };
    return checklistTicked ? { passed: true, message: `Customer is ticked for ${draft.category}.` } : { passed: false, message: `The owner has not ticked this customer for ${draft.category} messages.` };
  }
}

export class ApprovalGate {
  get name() { return 'DRAFT_APPROVED'; }
  async check({ draft, approval }) {
    if (!approval) return { passed: false, message: 'An employee has not approved this draft.' };
    if (approval.fingerprint !== draft.contentFingerprint) return { passed: false, message: 'The draft changed after approval; approve it again.' };
    return { passed: true, message: `Approved by ${approval.approvedBy}.` };
  }
}
