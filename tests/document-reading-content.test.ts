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


test("unlabelled abstract and body survive first-page submission dates and affiliations", () => {
 const abstract="Natural polymeric hydrogels are expected to serve as potential structural biomaterials. ".repeat(4);
 const blocks=[block(1,0,"A scientific title"),block(1,1,abstract),block(1,2,"Introduction"),block(1,3,"The introduction explains the research."),block(1,4,"College of Chemistry, University"),block(1,5,"Received 4th June 2021, Accepted 2nd July 2021"),block(1,6,"New concepts "+abstract),block(2,0,"Results and discussion"),block(2,1,"Ethanol changes the hydrophobic interactions."),block(3,0,"Conclusions"),block(3,1,"The hydrogels are strong."),block(3,2,"References"),block(3,3,"1 Author A, 2021.")];
 const texts=documentReadingContent(blocks).body.map(b=>b.text);
 assert.ok(texts.includes(abstract));assert.ok(texts.includes("Ethanol changes the hydrophobic interactions."));assert.ok(texts.includes("The hydrogels are strong."));
 assert.ok(!texts.some(t=>t?.startsWith("Received")));assert.ok(!texts.includes("References"));
});


test("page-number journal footers and fragmented numeric tables stay outside body translation", () => {
 const blocks=[block(1,0,"Abstract This paper explains a hydrogel."),block(1,1,"College of Chemistry, University X"),block(1,2,"Received 1 June 2021, Accepted 2 July 2021"),block(2,0,"2504 | Mater. Horiz., 2021, 8, 2503–2512"),block(2,1,"Table 1 Physical properties of the hydrogels"),block(2,2,"Samples"),block(2,3,"Compression"),block(2,4,"CHTA2-60 2"),block(3,0,"Conclusions The material performs well.")];
 const result=documentReadingContent(blocks);assert.deepEqual(result.body.map(b=>b.id),["doc-p1-b0","doc-p3-b0"]);assert.equal(result.captions.length,1);
});
