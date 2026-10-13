# 本轮来源与适配

2026-10-12。四个组件库的原文件、固定版本与许可随本私有仓库保存。没有导入原站商标、照片或演示视频。截图用于个人研究与对照。

| 来源 | 固定版本 | 权利说明 |
| --- | --- | --- |
| Magic UI / magicuidesign | 85f97fd27b053339af74ba9dd4ca428ee25989fb | MIT，见 magicui/LICENSE.md |
| React Bits / David Haz | e2eb04d89d5be5a633dba7b2d4adfd274e053767 | MIT + Commons Clause，见 react-bits/LICENSE.md；不能把组件本身作为商品出售或再许可 |
| Kokonut UI / Dorian Baffier | 83eec6d982d400a18438001a8efdbac1f159dd43 | MIT，见 kokonut/LICENSE |
| Motion Primitives / ibelick | 120f64f6ca60348e251f929e9c81f11ccbe45eda | MIT，见 motion-primitives/LICENCE.md |

## 移植范围

- `specular-light.js` 保留 React Bits SpecularButton 的 GLSL、圆角边界参数化和着色程序编译，改写 DOM 生命周期、暂停、指针跟随、销毁。按需绘制，不循环占用 GPU；不支持 WebGL2 时保留按钮和静态细边。
- Magic UI 的绕边光、文字扫光、圆点铺满、呼吸环、光谱边、透视网格、流星、渐变边、斜线字影、立体字面、通知层叠和礼花：采用原分层/几何与交互方法，Motion/Tailwind/Confetti 依赖改为受控 WAAPI/CSS/DOM。
- React Bits GlassIcons 保留倾斜色片、透明前层和错开响应；当前是 CSS 模糊/高光适配，**未移植原站 WebGL 折射**。StarBorder 是双向边缘光的 CSS 适配，未移植其更新版光线着色器。GooeyNav 保留模糊合成、阈值矩阵、粒子回收与移动选中区；取消原全局监听。Folder、FlipCard、AccordionGallery 改用项目提供的真实标题与描述；没有原专属图片。Counter 保留逐位滚轮；GradientText/ShinyText 保留文字内流动色/扫光；Stepper 保留连线与步骤状态；PixelCard 改用可暂停 DOM 像素网格。
- Kokonut HoldButton 加入真实完成回调、提前松开/失焦/切后台取消和键盘长按；ParticleButton 的粒子改为可暂停 DOM 纸片；SwitchButton 用宿主状态替代全站主题依赖。
- Motion Primitives 的对照分界采用可拖动范围控件和裁切；Accordion 用网格行高度插值替换 motion 测量。

## 可组合材质

材质不是新增组件条目。九种材质加“原有外观”，可用于22款按钮；颜色独立。磨砂/清透玻璃参考 React Bits 玻璃分层与 SpecularButton 高光。陶瓷、金属、硅胶、果冻、压纹纸是本库原创 CSS 材质研究，不能宣称复制自某个成品或已获得用户审美认可。当前玻璃是 blur/saturate/高光，无真实背景折射。材质不改变 DOM、业务回调或按钮禁用语义。

原站静帧在 `docs/materials-evidence/sources/`，31个条目逐项记录 codeUrl、licensePath 和 visualEvidence。截图/来源不等于用户认可，也不等于复杂动效与原站逐帧一致。
