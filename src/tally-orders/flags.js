export function orderFlags(env=process.env){return {
  sales_orders:env.TALLY_FETCH_SALES_ORDERS_ENABLED==='true',
  purchase_orders:env.TALLY_FETCH_PURCHASE_ORDERS_ENABLED==='true',
  comparison:env.TALLY_ORDER_COMPARISON_ENABLED==='true'
};}
