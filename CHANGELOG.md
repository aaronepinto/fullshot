# Changelog

## [0.3.1](https://github.com/smollet-app/screencappy/compare/v0.3.0...v0.3.1) (2026-08-16)


### 🐛 Bug fixes

* **capture:** explain browser-protected pages instead of an ERR badge ([6566199](https://github.com/smollet-app/screencappy/commit/6566199ec81b9df767c1f48ce338924586323d69))
* **capture:** probe Web Store pages instead of assuming Chrome's lockdown ([f399780](https://github.com/smollet-app/screencappy/commit/f399780c0eee18c4221d677ae254c9b70e3ac546))
* **editor:** stop the drawers cropping the first row's rings ([5408191](https://github.com/smollet-app/screencappy/commit/5408191dcf4aca5ef3cb9b74fb50659ac707e63c))


### 📝 Documentation

* preserve the agent bridge architecture spec on the roadmap ([5a88e70](https://github.com/smollet-app/screencappy/commit/5a88e7009c774a1481178b9a3ee9bcac627a177a))

## [0.3.0](https://github.com/smollet-app/screencappy/compare/v0.2.0...v0.3.0) (2026-08-16)


### ✨ Features

* **capture:** ask what to capture when a page reports an impossible height ([721bb95](https://github.com/smollet-app/screencappy/commit/721bb956062e5b26bbf2b609002341220df13698))
* **capture:** capture the document inside a full-bleed iframe ([f725041](https://github.com/smollet-app/screencappy/commit/f725041593304bccd020a6cf02269c9829f88233))
* **capture:** say so when content is clipped away with no way to scroll ([4277369](https://github.com/smollet-app/screencappy/commit/4277369a1f10201134b70f4a51fca0c6f0887884))
* **editor:** one-row toolbar, roving tool focus, and an honest empty state ([c00536a](https://github.com/smollet-app/screencappy/commit/c00536ad2b179abac471637510f057ec96f8cbea))
* **editor:** say where an export actually landed ([380b5e0](https://github.com/smollet-app/screencappy/commit/380b5e0ed72ce9395484a69954be2839187462e8))
* **options:** show the running build, its source, and what this browser lacks ([773f63f](https://github.com/smollet-app/screencappy/commit/773f63ff5f86d301573297d146574a66275cfc9c))


### 🐛 Bug fixes

* **capture:** find scroll containers inside open shadow roots ([29af071](https://github.com/smollet-app/screencappy/commit/29af0714527b8f363afed455cbeff099c47c517a))
* **capture:** hold each tile for images that are still arriving ([34cbb2d](https://github.com/smollet-app/screencappy/commit/34cbb2d4f82ab2d8525cb303eb6d95a796cdfac7))
* **capture:** keep the region size chip on screen at the bottom edge ([0f4299b](https://github.com/smollet-app/screencappy/commit/0f4299b4b77947c45520b97000e5e5f5b1c4e537))
* **capture:** neutralise scroll-driven animation timelines ([0889d75](https://github.com/smollet-app/screencappy/commit/0889d75650d48930084fac57f22eb96c3a456ad6))
* **capture:** pin furniture to the edge it belongs to, not to tile one ([845a0a1](https://github.com/smollet-app/screencappy/commit/845a0a1302202930247a6651fa7becfe84a83989))
* **capture:** refuse pages that report an implausible height ([2a85dce](https://github.com/smollet-app/screencappy/commit/2a85dce3b0dede8b616a1c92b6f20953679c870a))
* **capture:** turn scroll snapping off for the capture ([d4e0101](https://github.com/smollet-app/screencappy/commit/d4e0101dbd2037d54bc5645f32c70cb9ad65f03c))
* **capture:** wait for images the way a slow page actually loads them ([70ff77a](https://github.com/smollet-app/screencappy/commit/70ff77ac06981f30614827952a4caba28f6e9258))
* **editor:** repair the controls and layout the UI sweep found ([72de590](https://github.com/smollet-app/screencappy/commit/72de59093abdf961632432163f89ba194c3c6e62))
* **export:** quiet download mode ([3249e61](https://github.com/smollet-app/screencappy/commit/3249e61a7d9dd2db97fc52075bbfdd8847bedd9c))
* **export:** stop download mode from stealing focus and leaving a tab behind ([dc13359](https://github.com/smollet-app/screencappy/commit/dc13359916521d6fce52b28ae9cb3300c7ab7dc2))
* **options:** make the debugger grant reachable and answer reduced motion ([8ca856f](https://github.com/smollet-app/screencappy/commit/8ca856fc11fa4b0ec11f0ec5b306fda54c274140))
* **options:** tell the store-fallback build apart from a browser that cannot ([b9d33ff](https://github.com/smollet-app/screencappy/commit/b9d33fff559adeb85bd5c69b0c7ff87690f978d5))
* **stitch:** compose at the ratio the page reports, not the one a bitmap implies ([c89778c](https://github.com/smollet-app/screencappy/commit/c89778cbd8d65343d9c55d04d5fe26a0b64a3ca7))
* **stitch:** size each tile's box from its CSS coordinates, not its bitmap ([e77bf47](https://github.com/smollet-app/screencappy/commit/e77bf479c78963aa59d6d07502ffda1f3d2a6e7b))


### 📝 Documentation

* roadmap for post-launch releases ([2e088f0](https://github.com/smollet-app/screencappy/commit/2e088f0eef501e7840426abbb66a66d01f0526c2))


### ✅ Tests

* **e2e:** 100vh wrapper clipping content nothing can scroll ([b5d2f31](https://github.com/smollet-app/screencappy/commit/b5d2f310e015be7767e8b98ebc91101ba5636364))
* **e2e:** assert the capture leaves the page exactly as it found it ([6bb4dcd](https://github.com/smollet-app/screencappy/commit/6bb4dcdb32a330253b7552b1f391d1251056de50))
* **e2e:** difficult-site gauntlet with the engine fixes it exposed ([b2a017f](https://github.com/smollet-app/screencappy/commit/b2a017fc9d86bc7210ae90bfd42e2082fb0ce4f8))
* **e2e:** frames two deep and one from a foreign origin ([cf18cd7](https://github.com/smollet-app/screencappy/commit/cf18cd776ba61f19119b1d1f9c4e436b823af92f))
* **e2e:** full-bleed embedded document, iframe and plugin ([c672155](https://github.com/smollet-app/screencappy/commit/c672155af45ae1af461b36246e6e011a67bd739e))
* **e2e:** infinite scroll, capped and naturally terminating ([9c1680f](https://github.com/smollet-app/screencappy/commit/9c1680f77bc14da4bd47a4ac0e935654cf198acd))
* **e2e:** lazy images behind a delaying fixture server ([df1f179](https://github.com/smollet-app/screencappy/commit/df1f179bbcae91767bc22c957411dc1dc076aaf5))
* **e2e:** make the frames assertions independent of font metrics ([389f91b](https://github.com/smollet-app/screencappy/commit/389f91b75feb7919a1c121b293a67dcdec3ea87c))
* **e2e:** name the direction a composed image is wrong ([6a9121b](https://github.com/smollet-app/screencappy/commit/6a9121b0743726f390e2117c434210fd7a8ead9f))
* **e2e:** pages at and past the composed-image ceiling ([7a92427](https://github.com/smollet-app/screencappy/commit/7a924271b3f5bedd68ea53ed50f340e80e71f392))
* **e2e:** pinned furniture on all four edges ([4b44d17](https://github.com/smollet-app/screencappy/commit/4b44d17c07a60d68c8aa323b8c4aaf55d766e00d))
* **e2e:** pixel-level gauntlet harness and the reveal-on-scroll fixture ([efbdf83](https://github.com/smollet-app/screencappy/commit/efbdf830416e5eb0be4464df51bdea79f979683c))
* **e2e:** run a seam detector at four device pixel ratios ([0835d4b](https://github.com/smollet-app/screencappy/commit/0835d4b8dd476486f4203240d824362b4b300f6a))
* **e2e:** scroll-locked modal over a long page ([03a562f](https://github.com/smollet-app/screencappy/commit/03a562f5075dbd05aff52c17fe3794f98e15e897))
* **e2e:** smooth scrolling and scroll snapping, and a gap detector ([656befb](https://github.com/smollet-app/screencappy/commit/656befb7e15f106496d2754a5b9baa1f2bfeea65))
* **e2e:** sticky and scrollable content inside shadow roots ([492bcb6](https://github.com/smollet-app/screencappy/commit/492bcb685941601236311b551db869d1f58b9112))
* **e2e:** witness for the parallax background fix ([f23e57b](https://github.com/smollet-app/screencappy/commit/f23e57bd34c2aa136ab1f6ebdee7c790fab3e266))
* **ui:** cover the new reporting, and stop describing controls twice ([8ee6209](https://github.com/smollet-app/screencappy/commit/8ee6209672ad53b794a46cac59da819864d40111))
* **ui:** cover the roving toolbars, the colour popover and the one-row bar ([6d82d58](https://github.com/smollet-app/screencappy/commit/6d82d5858a5f1dbd12819a4d1d15ff2d6654a18f))
* **ui:** exhaustive control sweep with the fixes it motivated ([ba1caa8](https://github.com/smollet-app/screencappy/commit/ba1caa877cc4719b87e449d0fcfc42e5430f102b))
* **ui:** sweep every control, photograph every state, drive both overlays ([930de58](https://github.com/smollet-app/screencappy/commit/930de5876aea708244dafd10bd4eda76399b17f4))

## [0.2.0](https://github.com/smollet-app/screencappy/compare/v0.1.0...v0.2.0) (2026-08-15)


### ⚠ BREAKING CHANGES

* lowercase the screencappy brand and drop dash dividers
* license the project under Apache-2.0

### ✨ Features

* adopt the Screencappy name ([43a1b3b](https://github.com/smollet-app/screencappy/commit/43a1b3b5b7b7af35332f1624992dcdc86ef171cb))
* **build:** Firefox build target plus cross-browser debugger guards ([32496e7](https://github.com/smollet-app/screencappy/commit/32496e720c97220ff2c5202ac16c5d11656d6e5a))
* **build:** store-fallback target without the debugger permission ([ed7990b](https://github.com/smollet-app/screencappy/commit/ed7990bfe97eb661d4663c17adaae57da5aea6ab))
* **capture:** auto-load infinite-scroll pages before capturing ([380be0d](https://github.com/smollet-app/screencappy/commit/380be0db877b34fa6ecf58ffe8e3d412b6a93231))
* **capture:** capture iframes in depth from the element picker ([91433e1](https://github.com/smollet-app/screencappy/commit/91433e1c703a48dd6ae0edc6047f94b67382bb59))
* **capture:** capture the visible area when a page blocks scrolling ([c76e308](https://github.com/smollet-app/screencappy/commit/c76e3081308614a7d7febdd298382780928cc513))
* **capture:** delayed capture with a badge countdown ([e1bf0ed](https://github.com/smollet-app/screencappy/commit/e1bf0ed52ddb56c9755d6d38da7e32e223931472))
* **capture:** mobile-width capture via Turbo device emulation ([96aeba7](https://github.com/smollet-app/screencappy/commit/96aeba70be73bb30550996aeb519bd16f93d16d9))
* **capture:** pick and capture a single element, DevTools style ([6f2782a](https://github.com/smollet-app/screencappy/commit/6f2782ad5bc5d7d8c4fa3c2a87fe06b2ac173831))
* **capture:** stitch pages that scroll inside an inner container ([894497d](https://github.com/smollet-app/screencappy/commit/894497df049708a5b30faee0efe993282ae8e110))
* **capture:** wait out async renderers and probe blocked scrolling ([fa7c726](https://github.com/smollet-app/screencappy/commit/fa7c726887faa75097b39fa24eb7fdaef1740245))
* **editor:** a real manipulation model for shapes ([fb522c2](https://github.com/smollet-app/screencappy/commit/fb522c24f1a1cc949e359f53bf34ed385fc34401))
* **editor:** add right-click menu for full-image copy and download ([ec4254e](https://github.com/smollet-app/screencappy/commit/ec4254ef65e401e7b22132371229abe765c87e0d))
* **editor:** an inventory of what has been drawn ([d487705](https://github.com/smollet-app/screencappy/commit/d487705caf5e10c14ff8e22251e9e87338ef6699))
* **editor:** keyboard precision for the selection ([7afc1c5](https://github.com/smollet-app/screencappy/commit/7afc1c539b77e444c769195c0d001e024d100075))
* **editor:** multi-select, marquee and z-order ([556998c](https://github.com/smollet-app/screencappy/commit/556998c7ce6bd25fee40f42dc11efeadc7861544))
* **editor:** re-edit a text label in place ([d906b03](https://github.com/smollet-app/screencappy/commit/d906b0370c946e32b382b7149c13d03f410a47ba))
* **editor:** style controls act on what they claim to ([3c9d759](https://github.com/smollet-app/screencappy/commit/3c9d759fbbe1f7e4f8a7c1abd243370eac002eee))
* **export:** save pages as searchable PDFs with selectable text ([a32e06d](https://github.com/smollet-app/screencappy/commit/a32e06db3be0ca000ba782d2f38f77723616dda7))
* **icons:** redraw the product icon as a page in a viewfinder ([60cbc4a](https://github.com/smollet-app/screencappy/commit/60cbc4a50413683b1809007790efd1cb0166deb9))
* **icons:** the original lens, rethemed onto the family palette ([ac35a1c](https://github.com/smollet-app/screencappy/commit/ac35a1cb44a0ce6a5348792ea3b6eacde8985f53))
* initial release of Screencappy ([f0545ac](https://github.com/smollet-app/screencappy/commit/f0545ace62e4bfb712672ba73a44cd1cfe2b05d7))
* license the project under Apache-2.0 ([e382ea3](https://github.com/smollet-app/screencappy/commit/e382ea39ed09e97aa871a60231039ceb523d6650))
* lowercase the screencappy brand and drop dash dividers ([e5d28a1](https://github.com/smollet-app/screencappy/commit/e5d28a18984a66242d2537d46f9335003aa52bbd))
* **site:** add competitor comparison pages and the alternatives hub ([25db248](https://github.com/smollet-app/screencappy/commit/25db248d04ae9be4f4f6179b167c9d56fc83d741))
* **site:** add screencappy.smollet.app landing page and privacy policy ([614a051](https://github.com/smollet-app/screencappy/commit/614a0512575d21123a2a7642e4ed6ade012ca7a8))
* **site:** full marketing site with SEO and answer-engine assets ([05dd6f0](https://github.com/smollet-app/screencappy/commit/05dd6f0c87f50d5822ef011eb513592a6debd738))
* **site:** reconcile the GoFullPage page with refreshed research ([89e8e58](https://github.com/smollet-app/screencappy/commit/89e8e58d244be6320fcc953f601963f7732eabf3))
* **site:** restyle Screencappy on the Smollet editorial design system ([53b21f5](https://github.com/smollet-app/screencappy/commit/53b21f50049fe89e6bb1c87851a0b7418373bbac))
* **site:** rewrite the site for a general audience ([a0699e5](https://github.com/smollet-app/screencappy/commit/a0699e5100d0d67be4c3985967456ec21de07516))
* **site:** show live project health badges on the homepage ([1c2f0b2](https://github.com/smollet-app/screencappy/commit/1c2f0b2efda60e951bc4e8526520b1dbf86b5970))
* **site:** smooth page to page navigation, no framework ([4499356](https://github.com/smollet-app/screencappy/commit/44993561f17bf8fc6a3e964cc47825dd8a3c6836))
* **site:** wire the comparison pages into site discovery ([dd143bf](https://github.com/smollet-app/screencappy/commit/dd143bf5492a9deae68014b67910c5e469bc12c9))


### 🐛 Bug fixes

* **build:** give tests their own TypeScript project ([7477def](https://github.com/smollet-app/screencappy/commit/7477def43252e5de07e43e2e6a8263a2565e1e3c))
* **capture:** hold the shot while rows are still streaming in ([5770c41](https://github.com/smollet-app/screencappy/commit/5770c41546917df82950b72b909018122c19f3f2))
* **capture:** pin sticky elements inside open shadow DOM ([470a238](https://github.com/smollet-app/screencappy/commit/470a238f63f234f391e2959d5f7597a644935d93))
* **capture:** stop parallax backgrounds repeating in every tile ([326b0ec](https://github.com/smollet-app/screencappy/commit/326b0ec0aecad2d5902410b29b738b4510798ecd))
* declare the debugger permission as required ([9a0bea6](https://github.com/smollet-app/screencappy/commit/9a0bea682aa632b807845334351d105b6a96f8c1))
* **editor:** hit test the shape, not its bounding box ([d78932d](https://github.com/smollet-app/screencappy/commit/d78932d41774a8aa4ea0e8ec23278b8de41c5cc6))
* **editor:** interrupted gestures roll back cleanly ([093dd82](https://github.com/smollet-app/screencappy/commit/093dd824d0de28799ea63ac5143c5ec007cd68ec))
* **editor:** keep hidden panels hidden despite author display rules ([fa0b90d](https://github.com/smollet-app/screencappy/commit/fa0b90d47009f1423ecfccbf69bc53c72b07a7bd))
* **editor:** rebuild text entry as an explicit state machine ([8dcf5f0](https://github.com/smollet-app/screencappy/commit/8dcf5f0dd7213215f2ae78eb06195467758c83db))
* **editor:** replace hand-drawn icons with Lucide ([00a8243](https://github.com/smollet-app/screencappy/commit/00a82430d09d375138b623205edcdcf1c3f4c131))
* **editor:** rotation, working zoom, honest cursors and unclipped chrome ([46f5a92](https://github.com/smollet-app/screencappy/commit/46f5a92b3a8205e64aaa6180c3c467c5f2d071d3))
* **editor:** the open text editor owns the style bar ([0951cc1](https://github.com/smollet-app/screencappy/commit/0951cc1778a4b6534e395d2ced4a548592598c1d))
* **site:** drop prerendering that tripped bot checks, guard the fade ([32c0734](https://github.com/smollet-app/screencappy/commit/32c0734b08192329f4fa5300cf980bc3869ffa47))
* **site:** stack the install card, one browser sentence, centred monogram ([aaa1704](https://github.com/smollet-app/screencappy/commit/aaa17041a04afeee8402df31032cdf3dd2612034))
* **site:** the debugger permission is required, not optional ([4d0b66b](https://github.com/smollet-app/screencappy/commit/4d0b66b221556b7e18d0fa3c62b960520435d42a))
* store submission readiness across manifest, privacy, and builds ([cf2cc4c](https://github.com/smollet-app/screencappy/commit/cf2cc4c85ae26e65935bb9c912b494558da256a9))
* **tests:** type the e2e harnesses so editors report nothing ([4b0f5ef](https://github.com/smollet-app/screencappy/commit/4b0f5ef533fdcc5d2817098fb55445d6847193e3))


### ⚡ Performance

* **capture:** size the settle from the latency the page has shown ([a0e722f](https://github.com/smollet-app/screencappy/commit/a0e722f50710de9bb8704817ffe950e897e065b2))
* **site:** stop every navigation waiting on the network and the fade ([9712fd0](https://github.com/smollet-app/screencappy/commit/9712fd0315a1b6b90446678a78f35a68b4c7656c))


### ♻️ Refactoring

* **brand:** lowercase screencappy and smollet everywhere they are read ([722f2ce](https://github.com/smollet-app/screencappy/commit/722f2ce0f4e4f5aca6b54772e3b23d46a718eda3))


### 📝 Documentation

* **readme:** record the zoom keys and annotation rotation ([212642c](https://github.com/smollet-app/screencappy/commit/212642c9d062fde730d8954109eb93cc2f33e9bd))
* rewrite the README as a product page ([97ad9ab](https://github.com/smollet-app/screencappy/commit/97ad9ab094bf09267e7e12646374c33bdbcadf01))
* state which browsers CI actually tests ([c83a328](https://github.com/smollet-app/screencappy/commit/c83a3283c8c3ae21a97add76765c29fd87545a37))


### ✅ Tests

* add real-Chrome e2e capture test ([ecd41f0](https://github.com/smollet-app/screencappy/commit/ecd41f01d863134a4e3ef1153c75b68dd31dce70))
* add unit tests and run the full suite in CI ([f5b69d0](https://github.com/smollet-app/screencappy/commit/f5b69d089a8a1f1542594651ff7fbe35b5369298))
* **capture:** fixtures and scenarios for the known ways capture breaks ([de38c20](https://github.com/smollet-app/screencappy/commit/de38c208d86033aef820b6315a6a6b9dba0c2afd))
* **editor:** Playwright UX harness and an editor test surface ([81b6163](https://github.com/smollet-app/screencappy/commit/81b6163cfe9b96bd92d02ebb74797b342ed05458))
* **firefox:** real capture end to end under geckodriver ([64311b5](https://github.com/smollet-app/screencappy/commit/64311b5a5d05d2caf2334600a46687a5b8f07315))
* share e2e fixtures and label capture runs by browser ([77754ac](https://github.com/smollet-app/screencappy/commit/77754ac7ef63cc0a636b05c4029e3a2183a03442))

## 0.1.0 (2026-08-15)


### ⚠ BREAKING CHANGES

* license the project under Apache-2.0

### ✨ Features

* adopt the Screencappy name ([f90de0e](https://github.com/smollet-app/screencappy/commit/f90de0eda3617889de7854cde68e3782794c83a3))
* **build:** Firefox build target plus cross-browser debugger guards ([ae32191](https://github.com/smollet-app/screencappy/commit/ae32191079f254369b40ebdbe185d175ad7b1466))
* **capture:** auto-load infinite-scroll pages before capturing ([1c4e074](https://github.com/smollet-app/screencappy/commit/1c4e0745dff297cfb422238caf7978a4207a39c7))
* **capture:** capture iframes in depth from the element picker ([5de0cfc](https://github.com/smollet-app/screencappy/commit/5de0cfc9f84b2707e15a738a291de3e38ad71099))
* **capture:** capture the visible area when a page blocks scrolling ([ea94e89](https://github.com/smollet-app/screencappy/commit/ea94e89a68dde440e91a5a6532ba2a6dd55a874c))
* **capture:** delayed capture with a badge countdown ([65c2211](https://github.com/smollet-app/screencappy/commit/65c2211efb56f553aeae73a09d018a319f3c441c))
* **capture:** mobile-width capture via Turbo device emulation ([6bee917](https://github.com/smollet-app/screencappy/commit/6bee917da79e28bad5671a819407b2f7612e43da))
* **capture:** pick and capture a single element, DevTools style ([8be3894](https://github.com/smollet-app/screencappy/commit/8be38941cadd654d9d0f1fb2fd7b27e2a9df3150))
* **capture:** stitch pages that scroll inside an inner container ([56ed289](https://github.com/smollet-app/screencappy/commit/56ed289b871af427fbd443f26efded53b8462428))
* **capture:** wait out async renderers and probe blocked scrolling ([d96f2a1](https://github.com/smollet-app/screencappy/commit/d96f2a1baec6e6263cdd6ee9247a059fea2c1828))
* **editor:** add right-click menu for full-image copy and download ([ec4254e](https://github.com/smollet-app/screencappy/commit/ec4254ef65e401e7b22132371229abe765c87e0d))
* **export:** save pages as searchable PDFs with selectable text ([5670f88](https://github.com/smollet-app/screencappy/commit/5670f88f78e57466271ae3bb8189a53e4d9a9a0d))
* initial release of Screencappy ([f0545ac](https://github.com/smollet-app/screencappy/commit/f0545ace62e4bfb712672ba73a44cd1cfe2b05d7))
* license the project under Apache-2.0 ([2d43196](https://github.com/smollet-app/screencappy/commit/2d4319674f24b94ce1947c15658be07a77387307))
* **site:** add competitor comparison pages and the alternatives hub ([33e9559](https://github.com/smollet-app/screencappy/commit/33e9559d103a4e6f7f12177663a39efcc4f763a7))
* **site:** add screencappy.smollet.app landing page and privacy policy ([614a051](https://github.com/smollet-app/screencappy/commit/614a0512575d21123a2a7642e4ed6ade012ca7a8))
* **site:** add the Smollet umbrella site ([9b6040f](https://github.com/smollet-app/screencappy/commit/9b6040f08a40e4e329f21c5098d8659b0d0c0a6b))
* **site:** full marketing site with SEO and answer-engine assets ([5a18735](https://github.com/smollet-app/screencappy/commit/5a18735bb1bab77222c5f31752fbe72e6e7298f5))
* **site:** reconcile the GoFullPage page with refreshed research ([1999e4b](https://github.com/smollet-app/screencappy/commit/1999e4b0fbf71d5b4c0485427b1296c08efb5d98))
* **site:** restyle Screencappy on the Smollet editorial design system ([ed0cc38](https://github.com/smollet-app/screencappy/commit/ed0cc381fb523ef22f2574f96f3c65dabff1ec04))
* **site:** show live project health badges on the homepage ([f23b6df](https://github.com/smollet-app/screencappy/commit/f23b6dfd4d429d883074b62bc977841d955858e8))
* **site:** wire the comparison pages into site discovery ([82df641](https://github.com/smollet-app/screencappy/commit/82df6411fe8fed224864be993e2154d308f9c478))


### 🐛 Bug fixes

* **build:** give tests their own TypeScript project ([59ccc20](https://github.com/smollet-app/screencappy/commit/59ccc20d89601481842f630c708a16bafa5418f6))
* **capture:** hold the shot while rows are still streaming in ([118f2fa](https://github.com/smollet-app/screencappy/commit/118f2fa48d2bbead0ab429f52e21ec1d0d09d13e))
* **capture:** pin sticky elements inside open shadow DOM ([3bee54e](https://github.com/smollet-app/screencappy/commit/3bee54ee405e1707e3900b2ea1d9f96fbd6e674c))
* **capture:** stop parallax backgrounds repeating in every tile ([b035d0a](https://github.com/smollet-app/screencappy/commit/b035d0af1531340d9365e258481c086a6f6686e1))
* **editor:** keep hidden panels hidden despite author display rules ([fa0b90d](https://github.com/smollet-app/screencappy/commit/fa0b90d47009f1423ecfccbf69bc53c72b07a7bd))
* **tests:** type the e2e harnesses so editors report nothing ([c6b20f2](https://github.com/smollet-app/screencappy/commit/c6b20f227c4d9d95201b005cee82bd20dcf034a8))


### ⚡ Performance

* **capture:** size the settle from the latency the page has shown ([1a0075e](https://github.com/smollet-app/screencappy/commit/1a0075ee2abcf40fe8aec5dae331daa07fcbe903))


### 📝 Documentation

* rewrite the README as a product page ([9a0080e](https://github.com/smollet-app/screencappy/commit/9a0080eef309aeaa20d233e110be56d952be4f69))
* state which browsers CI actually tests ([da2fbd4](https://github.com/smollet-app/screencappy/commit/da2fbd43e2105f46f2417663720a2906b26fbc8a))


### ✅ Tests

* add real-Chrome e2e capture test ([ecd41f0](https://github.com/smollet-app/screencappy/commit/ecd41f01d863134a4e3ef1153c75b68dd31dce70))
* add unit tests and run the full suite in CI ([f5b69d0](https://github.com/smollet-app/screencappy/commit/f5b69d089a8a1f1542594651ff7fbe35b5369298))
* **capture:** fixtures and scenarios for the known ways capture breaks ([6332b86](https://github.com/smollet-app/screencappy/commit/6332b8699f5957244913c5a769c4ec6f85e941ff))
* **firefox:** real capture end to end under geckodriver ([5cc5f03](https://github.com/smollet-app/screencappy/commit/5cc5f03df2450915fd403cb7f74c4dc726a7dea3))
* share e2e fixtures and label capture runs by browser ([bbc7430](https://github.com/smollet-app/screencappy/commit/bbc7430d1fa2940edd9e93254a2610d3e4792c04))


### 🧹 Chores

* set initial release version ([bdad01c](https://github.com/smollet-app/screencappy/commit/bdad01cd43931df7acf4a7c43baa10b56fe44e28))
