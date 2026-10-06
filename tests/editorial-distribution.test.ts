import assert from "node:assert/strict";
import test from "node:test";
import { distributionSatisfied } from "../lib/editorialDistribution";

test("all categories and the total may exceed former ceilings",()=>{
  assert.equal(distributionSatisfied({时事:100,科技:100,文化:100,商业:100}),true);
});
test("each category must be strictly greater than 13",()=>{
  for(const category of ['时事','科技','文化','商业']) assert.equal(distributionSatisfied({...{时事:100,科技:100,文化:100,商业:100},[category]:13}),false);
  assert.equal(distributionSatisfied({时事:14,科技:14,文化:14,商业:14}),true);
  assert.equal(distributionSatisfied({时事:14,科技:18,文化:25,商业:50}),true);
});
