import type { StudyPolicy } from "@/types/study";

export const DEFAULT_STUDY_POLICY:StudyPolicy={
 rewardsEnabled:true,pointsPerNew:1,dailyRewardCap:50,rewardDays:90,streakMinNew:5,
 profileEnabled:true,profileCost:5,minimumReadingMinutes:60,minimumLookups:50,
 milestones:[
  {days:2,points:50,plan:null,months:0},{days:3,points:100,plan:null,months:0},
  {days:7,points:500,plan:null,months:0},{days:21,points:1000,plan:null,months:0},
  {days:30,points:0,plan:"basic",months:1},{days:60,points:0,plan:"plus",months:2},
  {days:180,points:0,plan:"plus",months:6},{days:365,points:0,plan:"max",months:12},
 ],
};
export function validateStudyPolicy(value:unknown):StudyPolicy {
 const p=value as StudyPolicy;
 if(!p||typeof p.rewardsEnabled!=="boolean"||typeof p.profileEnabled!=="boolean")throw new Error("Invalid policy");
 for(const [key,min,max] of [["pointsPerNew",0,100],["dailyRewardCap",0,10000],["rewardDays",1,3650],["streakMinNew",1,50],["profileCost",1,100],["minimumReadingMinutes",1,3000],["minimumLookups",1,1000]] as const){
  const n=p[key];if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error("Invalid policy value");
 }
 if(!Array.isArray(p.milestones)||p.milestones.length>24)throw new Error("Invalid milestones");
 const days=new Set<number>();
 const milestones=p.milestones.map(m=>{
  if(!m||!Number.isSafeInteger(m.days)||m.days<1||m.days>3650||days.has(m.days)||!Number.isSafeInteger(m.points)||m.points<0||m.points>1000000
   ||![null,"basic","plus","max"].includes(m.plan)||!Number.isSafeInteger(m.months)||m.months<0||m.months>24||Boolean(m.plan)!==(m.months>0))throw new Error("Invalid milestone");
  days.add(m.days);return {days:m.days,points:m.points,plan:m.plan,months:m.months};
 }).sort((a,b)=>a.days-b.days);
 return {rewardsEnabled:p.rewardsEnabled,pointsPerNew:p.pointsPerNew,dailyRewardCap:p.dailyRewardCap,rewardDays:p.rewardDays,streakMinNew:p.streakMinNew,
  profileEnabled:p.profileEnabled,profileCost:p.profileCost,minimumReadingMinutes:p.minimumReadingMinutes,minimumLookups:p.minimumLookups,milestones};
}
