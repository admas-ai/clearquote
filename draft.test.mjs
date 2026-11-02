import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_PRICES } from './src/data/initialData.ts';
import { calculateDraft, canConfirmDraft, parseDrawerInput } from './src/utils/draft.ts';
import { parseNaturalLanguagePrompt, calculateQuoteItems } from './src/utils/calculator.ts';
import { formatMoney, moneyToCents, itemTotal } from './src/utils/currency.ts';
const request={dimensions:'48-inch Compact Desk',material:'White Oak Hardwood (Solid)',drawers:2,includeDelivery:true,source:'AdmasLLM'};

test('review keeps catalog totals and AI provenance when options change',()=>{
 const draft=calculateDraft(INITIAL_PRICES,request);assert.equal(draft.totalAmount,1130);assert.ok(canConfirmDraft(draft));assert.match(draft.notes,/AdmasLLM/);
 const revised=calculateDraft(INITIAL_PRICES,{...draft,drawers:1,includeDelivery:false});assert.equal(revised.totalAmount,825);assert.equal(revised.items.length,3);assert.match(revised.notes,/pickup/);
});
test('blank, fractional, negative and out-of-range counts cannot become a confirmed draft',()=>{
 for(const input of ['', '1.5','-1','7','12','abc']) {
  const draft=calculateDraft(INITIAL_PRICES,{...request,drawers:parseDrawerInput(input)});
  assert.equal(draft.isUncertain,true,input);assert.equal(canConfirmDraft(draft),false,input);assert.equal(draft.items.length,0,input);
 }
 assert.equal(calculateDraft(INITIAL_PRICES,{...request,drawers:0,includeDelivery:false}).totalAmount,700);
});
test('human corrections resolve warnings and missing catalog entries remain blocked',()=>{
 const missing=INITIAL_PRICES.filter(item=>item.category!=='labor');
 assert.equal(canConfirmDraft(calculateDraft(missing,request)),false);
 const invalid=calculateDraft(INITIAL_PRICES,{...request,dimensions:'',drawers:Number.NaN});
 assert.equal(canConfirmDraft(invalid),false);
 assert.equal(canConfirmDraft(calculateDraft(INITIAL_PRICES,{...invalid,dimensions:request.dimensions,drawers:1})),true);
});
test('catalog money rejects negative, nonfinite and sub-cent prices',()=>{
 for(const value of [-1,NaN,Infinity,650.001,99]) {
  const prices=INITIAL_PRICES.map(item=>item.name===request.material?{...item,basePrice:value}:item);
  assert.equal(canConfirmDraft(calculateDraft(prices,request)),false,String(value));
 }
 const prices=INITIAL_PRICES.map(item=>({...item,basePrice:item.basePrice+.29}));
 assert.equal(calculateQuoteItems(prices,request.dimensions,request.material,1,true).totalAmount,1006.16);
 assert.equal(moneyToCents(.29),29);assert.equal(formatMoney(825),'$825.00');
});
test('local parsing preserves invalid numeric tokens and does not infer a delivery charge',()=>{
 for(const phrase of ['1.5 drawers','-1 drawers','1/2 drawers','12 drawers']) assert.equal(parseNaturalLanguagePrompt(`48-inch oak ${phrase}`,INITIAL_PRICES).drawers,-1,phrase);
 const parsed=parseNaturalLanguagePrompt('48-inch oak with one drawer',INITIAL_PRICES);assert.equal(parsed.drawers,1);assert.equal(parsed.includeDelivery,false);
});

test('manual revisions reject invalid quantities and sub-cent values',()=>{
 assert.equal(itemTotal([{quantity:2,unitPrice:125.29},{quantity:1,unitPrice:150.29}]),400.87);
 for(const item of [{quantity:NaN,unitPrice:125},{quantity:1.5,unitPrice:125},{quantity:-1,unitPrice:125},{quantity:1,unitPrice:1.001},{quantity:1,unitPrice:NaN}]) assert.equal(itemTotal([item]),null);
 assert.equal(itemTotal([]),null);
});
