import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { seedDemoData } from './lib/demo-data.mjs';

const db=await openDatabase(getConfig());
try{
  const loaded=await seedDemoData(db);
  console.log(loaded?'Demo data loaded: 3 customers, 4 items, 3 enquiries, 2 quotations, 1 sales order.':'Demo data v1 is already loaded.');
}finally{await db.close();}
