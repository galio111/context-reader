# 本次来源与使用范围

Magic UI：MIT；React Bits：MIT + Commons Clause。各自的 LICENSE.md 与 source.json 保存完整许可证、作者和本次读取的固定提交。源码只选公开版本，不含 Pro 付费内容。

公开源码用于这个私有个人库中的研究、预览及项目适配。React Bits 的附加条款限制出售、再许可或分发组件本身（含移植版本），不能把这些文件作为公共组件包再发布。集成到实际应用时保留许可证；不要将 MIT + Commons Clause 标为纯 MIT。

实现位置：studio/components/source-library.js / .css。21 个候选的逐项出处、固定源码 URL、移植或改编标记在 content/components-source-library.json。未采用的源文件（BlobCursor、ScrollProgress）仅为研究记录，不计入可用组件。

保留的主要机制：涟漪落点/直径；放大镜遮罩与变换原点；循环轨道/反向朝向；留口圆环；网格坐标；同心圆的尺寸与相位；像素亮度随机更新；词语进入/退出；滑杆的 sigmoid 越界阻尼；环形文字等分角度。

明确的差异：React/GSAP/Motion 生命周期改成 DOM/WAAPI；卡片的弹簧运动和拖动简化并标 source-adaptation；打字、计数与滚动文字采用本地时钟驱动。新增键盘、暂停、进度、减少动态、样式恢复及业务回调。演示内容为本库自己的文字，不挪用原站品牌素材。
