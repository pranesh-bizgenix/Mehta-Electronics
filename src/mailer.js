import nodemailer from 'nodemailer';

export async function sendQuotationEmail(config,{quote,to,subject,message,pdf}){
  if(!config.smtpHost||!config.smtpFrom)throw Object.assign(new Error('Email delivery is not configured.'),{code:'SMTP_NOT_CONFIGURED'});
  const transport=nodemailer.createTransport({host:config.smtpHost,port:config.smtpPort,secure:config.smtpSecure,auth:config.smtpUser?{user:config.smtpUser,pass:config.smtpPassword}:undefined});
  return transport.sendMail({from:config.smtpFrom,to,subject,text:message,attachments:[{filename:`${quote.quotation_number}.pdf`,content:pdf,contentType:'application/pdf'}]});
}
