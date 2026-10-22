import test from "node:test";
import assert from "node:assert/strict";
import { documentReadingContent } from "../lib/documentReadingContent";
import { createArticleTranslationBlocks } from "../lib/articleTranslationBlocks";
import { createArticleTranslationBlockCacheKey } from "../lib/articleTranslationIdentity";
import type { ImportedArticleBlock, ImportedArticle } from "../types/article";
import type { ArticleTranslationBlock } from "../types/reader";
const block = (page: number, index: number, text: string): ImportedArticleBlock => ({ id: `doc-p${page}-b${index}`, type: "paragraph", text });

test("academic reading excludes metadata and back matter while preserving caption and source identity", () => {
 const blocks = [block(1,0,"doi: 10.123/example"),block(1,1,"Title of research"),block(1,2,"Author A, Author B"),block(1,3,"ABSTRACT This is the scientific abstract."),block(1,4,"INTRODUCTION This is the body."),block(1,5,"1 School of Medicine, University X"),block(1,6,"City, Country"),block(1,7,"JOURNAL HEADER"),block(2,0,"The body continues on the next page."),block(2,1,"Figure 1 Structure and mechanism. (a) Synthesis. (b) Results."),block(2,2,"JOURNAL HEADER"),block(3,0,"CONCLUSIONS This is the conclusion."),block(3,1,"JOURNAL HEADER"),block(3,2,"Received 1 May 2025; accepted 2 May 2025"),block(3,3,"1 Author A, Author B, et al. Research title."),block(4,0,"Author biography and translated abstract.")];
 const before=JSON.stringify(blocks);const result=documentReadingContent(blocks);
 assert.deepEqual(result.body.map(b=>b.id),["doc-p1-b3","doc-p1-b4","doc-p2-b0","doc-p3-b0"]);
 assert.equal(result.captions.length,1);assert.equal(JSON.stringify(blocks),before);
 assert.equal(createArticleTranslationBlockCacheKey(result.captions[0] as ArticleTranslationBlock),createArticleTranslationBlockCacheKey(blocks[9] as ArticleTranslationBlock),"scope selection reuses existing cache without regeneration");
 const article={document:{id:"a".repeat(64),format:"pdf",name:"paper.pdf",pageCount:4},blocks} as ImportedArticle;
 assert.deepEqual(createArticleTranslationBlocks("",article).map(b=>b.id),result.body.map(b=>b.id));
 assert.equal(createArticleTranslationBlocks("",article,"captions").length,1);
 assert.deepEqual(createArticleTranslationBlocks("",article,"context").map(b=>b.id),["doc-p1-b3","doc-p1-b4","doc-p2-b0","doc-p2-b1","doc-p3-b0"]);
});

test("ordinary prose and figure references are retained without academic front matter",()=>{
 const blocks=[block(1,0,"A short essay"),block(1,1,"References to past events help explain this story."),block(1,2,"Figure 1 shows the result we discuss in this paragraph."),block(1,3,"A final paragraph without a formal conclusion.")];
 assert.deepEqual(documentReadingContent(blocks).body,blocks);
});

test("numbered method prose is not mistaken for a bibliography",()=>{
 const blocks=[block(1,0,"Abstract This paper discusses methods."),block(1,1,"Introduction This is the introduction."),block(2,0,"1 Add water and stir for 30 minutes."),block(2,1,"References to the control group are given in the text."),block(3,0,"Conclusions The process works.")];
 assert.equal(documentReadingContent(blocks).body.length,5);
});
