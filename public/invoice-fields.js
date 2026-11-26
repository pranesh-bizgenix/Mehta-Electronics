// Shared optional invoice fields. These describe supplied references; they do not
// generate statutory documents, establish credit terms or authorise remittance.
export const INVOICE_REFERENCE_FIELDS=[
 {key:'paymentTerms',label:'Confirmed payment terms',maxLength:300},
 {key:'dueDate',label:'Agreed payment due date',type:'date',maxLength:10},
 {key:'salesOrderNumber',label:'Sales order reference',maxLength:160},
 {key:'salesExecutive',label:'Sales executive',maxLength:160},
 {key:'customerPoNumber',label:'Customer PO reference',maxLength:160},
 {key:'consignmentNote',label:'Consignment / LR reference',maxLength:160},
 {key:'carrier',label:'Carrier / transporter',maxLength:160},
 {key:'packingListNumber',label:'Packing list reference',maxLength:160},
 {key:'packageNumber',label:'Package reference',maxLength:160},
 {key:'customerInstructions',label:'Customer instructions (as supplied)',maxLength:500},
 {key:'eWayBillNumber',label:'Existing e-Way bill reference',maxLength:160}
];
export const INVOICE_COMPANY_EXTRA_FIELDS=[
 {key:'cin',label:'Company CIN',maxLength:100},
 {key:'msme',label:'Company MSME / Udyam reference',maxLength:100},
 {key:'bankBeneficiary',label:'Confirmed bank beneficiary name',maxLength:200},
 {key:'bankName',label:'Confirmed bank name and branch',maxLength:200},
 {key:'bankAccount',label:'Confirmed remittance account number',maxLength:100},
 {key:'bankIfsc',label:'Confirmed remittance IFSC',maxLength:30}
];
