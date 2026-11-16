// Explicit fixture decisions, only called inside withTestTransaction.
import {RuleService} from '../src/modules/rules/rule-service.js';
import {RuleRepository} from '../src/modules/rules/rule-repository.js';
import {RuleRegistry,F1_RULES} from '../src/modules/rules/rule-definitions.js';
import {BUSINESS_RULES} from '../src/modules/rules/business-rule-definitions.js';
import {OPERATIONS_RULES} from '../src/modules/operations/operations-rules.js';
import {TransactionRunner,AuditRepository} from '../src/core/runtime.js';
import {hasPermission} from '../src/rbac.js';
import {forbidden} from '../src/core/errors.js';
export function fixtureRuleService(db){return new RuleService({registry:new RuleRegistry([...F1_RULES,...BUSINESS_RULES,...OPERATIONS_RULES]),repository:new RuleRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),access:{require(actor,permission){if(!hasPermission(actor,permission))throw forbidden();}}});}
export async function confirmFixturePricing(db,owner){
 const rules=fixtureRuleService(db),reason='VERIFY- confirmed pricing decisions';
 await rules.set(owner,'discount.levels',{level1:{min:'0',max:'10'},level2:{min:'10.000001',max:'20'},level3:{min:'20.000001',max:'100'}},reason);
 await rules.set(owner,'discount.role_limits',['OWNER','MANAGER','EXECUTIVE'].map(role=>({role,maximumPercent:'100'})),reason);
 await rules.set(owner,'quotation.approval_levels',[{name:'VERIFY- Independent reviewer',permission:'quotations.approve',appliesTo:'ALL'}],reason);
}
export async function confirmFixtureCredit(db,owner){
 const rules=fixtureRuleService(db),reason='VERIFY- confirmed credit decisions';
 await rules.set(owner,'credit.tiers',[{name:'VERIFY- Explicit limits',criteria:'VERIFY- reviewed customer-specific credit',limit:'100000'}],reason);
 await rules.set(owner,'credit.grace_days',0,reason);
 await rules.set(owner,'procurement.principal_ordering',{instructions:'VERIFY- independently review source order and supplier instructions'},reason);
}
