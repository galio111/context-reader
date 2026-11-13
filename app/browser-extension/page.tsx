import type { Metadata } from "next";
import { BrowserExtensionSettings } from "@/components/BrowserExtensionSettings";
export const metadata: Metadata = { title: "Chrome 划词助手 | Context Reader", description: "下载网页划词扩展，设置保存账号和可调节的解释浮窗。" };
export default function BrowserExtensionPage() { return <BrowserExtensionSettings />; }
