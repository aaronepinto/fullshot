# Changelog

## [0.3.0](https://github.com/smollet-app/screencappy/compare/v0.2.0...v0.3.0) (2026-08-16)


### ✨ Features

* **capture:** ask what to capture when a page reports an impossible height ([39bd380](https://github.com/smollet-app/screencappy/commit/39bd3804337969747767c17719a61d7b804885d6))
* **capture:** capture the document inside a full-bleed iframe ([3b4e76f](https://github.com/smollet-app/screencappy/commit/3b4e76f573f17ca652a43f0bea8fdcaba8b3018e))
* **capture:** say so when content is clipped away with no way to scroll ([2043e7b](https://github.com/smollet-app/screencappy/commit/2043e7bbfe65c89dbf31d4ccd1258e7c64ade7b9))
* **editor:** one-row toolbar, roving tool focus, and an honest empty state ([4a6f3d6](https://github.com/smollet-app/screencappy/commit/4a6f3d6dd70ef48cdc52289d8926a63ffd5edf94))
* **editor:** say where an export actually landed ([15cb03d](https://github.com/smollet-app/screencappy/commit/15cb03d556995c8482d86f663575428895f3f851))
* **options:** show the running build, its source, and what this browser lacks ([060e06c](https://github.com/smollet-app/screencappy/commit/060e06ca6d268be3435755be01e681be1cb7bbf4))


### 🐛 Bug fixes

* **capture:** find scroll containers inside open shadow roots ([43b32af](https://github.com/smollet-app/screencappy/commit/43b32afa649182ba3da27b24c56d6181012c13df))
* **capture:** hold each tile for images that are still arriving ([e0a484a](https://github.com/smollet-app/screencappy/commit/e0a484aba5239ba7bfcd3d3f35c77215f220cadd))
* **capture:** keep the region size chip on screen at the bottom edge ([cd9302e](https://github.com/smollet-app/screencappy/commit/cd9302eaa542cef798b992aa102c51a71f312bcb))
* **capture:** neutralise scroll-driven animation timelines ([515f1de](https://github.com/smollet-app/screencappy/commit/515f1de4da3c2f211a2256b11bbdda634ea49e78))
* **capture:** pin furniture to the edge it belongs to, not to tile one ([5af7058](https://github.com/smollet-app/screencappy/commit/5af70582be4772e1c3d393f1fe95855155422f36))
* **capture:** refuse pages that report an implausible height ([c54f63e](https://github.com/smollet-app/screencappy/commit/c54f63e5c6ef14dabb1ba71607db2e90e9fcc179))
* **capture:** turn scroll snapping off for the capture ([cf8bab7](https://github.com/smollet-app/screencappy/commit/cf8bab7b8a903415f007f8d0f77cb5eb2ba43b2b))
* **capture:** wait for images the way a slow page actually loads them ([e648c07](https://github.com/smollet-app/screencappy/commit/e648c0744073ac65e7de667d560956054560a512))
* **editor:** repair the controls and layout the UI sweep found ([7bfbf4c](https://github.com/smollet-app/screencappy/commit/7bfbf4c2a20a6bcb6a3494578105163ecbd6ded0))
* **export:** quiet download mode ([b50abc6](https://github.com/smollet-app/screencappy/commit/b50abc60842d005a2d105d9e08a00af67c6c5b4a))
* **export:** stop download mode from stealing focus and leaving a tab behind ([2f4c0bf](https://github.com/smollet-app/screencappy/commit/2f4c0bf7c787f9e1336def21f569ac670d051b7b))
* **options:** make the debugger grant reachable and answer reduced motion ([3369dab](https://github.com/smollet-app/screencappy/commit/3369dab3fc02508759862bea53da7865d9f0ddae))
* **options:** tell the store-fallback build apart from a browser that cannot ([b03b66a](https://github.com/smollet-app/screencappy/commit/b03b66a44c1d96a2f9a81eaaf3ede33515fe97a1))
* **stitch:** compose at the ratio the page reports, not the one a bitmap implies ([a218553](https://github.com/smollet-app/screencappy/commit/a218553ef418b3c415b24b2bb7d1ac77e3b3c589))
* **stitch:** size each tile's box from its CSS coordinates, not its bitmap ([c370dcb](https://github.com/smollet-app/screencappy/commit/c370dcbf353f7d5738d63b9146bbc208aeb10090))


### 📝 Documentation

* roadmap for post-launch releases ([138097b](https://github.com/smollet-app/screencappy/commit/138097bd67dcc22898abc3970427a5d6c93b1cad))
* **site:** align all web pages with the rewritten store listing copy ([12a4f4c](https://github.com/smollet-app/screencappy/commit/12a4f4c306c8c6f94487661ebc7f8b70b69f2dac))


### ✅ Tests

* **e2e:** 100vh wrapper clipping content nothing can scroll ([7554b8d](https://github.com/smollet-app/screencappy/commit/7554b8da32120610c29b278a3d61d6482a200902))
* **e2e:** assert the capture leaves the page exactly as it found it ([6eb6335](https://github.com/smollet-app/screencappy/commit/6eb633525fabab1b3c3bb3aa79ca04cdc99cb1d0))
* **e2e:** difficult-site gauntlet with the engine fixes it exposed ([1882226](https://github.com/smollet-app/screencappy/commit/1882226fdb8ff75442a7c4607b1740be04b1814c))
* **e2e:** frames two deep and one from a foreign origin ([c85ba5f](https://github.com/smollet-app/screencappy/commit/c85ba5fcc6fe50cf294cf0d2f087ea95f29e0729))
* **e2e:** full-bleed embedded document, iframe and plugin ([d1969be](https://github.com/smollet-app/screencappy/commit/d1969be1e58b9d946938063cd4ba6b765f49217b))
* **e2e:** infinite scroll, capped and naturally terminating ([a67827b](https://github.com/smollet-app/screencappy/commit/a67827b3515877fcf2f57d3108eef35e4f0fc58c))
* **e2e:** lazy images behind a delaying fixture server ([f0abcd2](https://github.com/smollet-app/screencappy/commit/f0abcd2f778b4ef802fa91966b743b6499703c31))
* **e2e:** make the frames assertions independent of font metrics ([a20c61f](https://github.com/smollet-app/screencappy/commit/a20c61f522737383421b9e702c2b8170ccb9edcb))
* **e2e:** name the direction a composed image is wrong ([25faa46](https://github.com/smollet-app/screencappy/commit/25faa4685c7ab3681e399df40c953ddefb60051f))
* **e2e:** pages at and past the composed-image ceiling ([6392c23](https://github.com/smollet-app/screencappy/commit/6392c23f5343f9cc30ad5484e52a73f38dea58f9))
* **e2e:** pinned furniture on all four edges ([48cfa4a](https://github.com/smollet-app/screencappy/commit/48cfa4a97e4263550c322136d1a24ee4d0699841))
* **e2e:** pixel-level gauntlet harness and the reveal-on-scroll fixture ([2c580b8](https://github.com/smollet-app/screencappy/commit/2c580b8d9f980f9ce9afe7fd505d4c70804dc5f2))
* **e2e:** run a seam detector at four device pixel ratios ([bae178a](https://github.com/smollet-app/screencappy/commit/bae178a776575ef076432dde07799dbaf2c29404))
* **e2e:** scroll-locked modal over a long page ([d6cd8d3](https://github.com/smollet-app/screencappy/commit/d6cd8d38a459dd9b764d3b56003a6e66a7e2b497))
* **e2e:** smooth scrolling and scroll snapping, and a gap detector ([527d678](https://github.com/smollet-app/screencappy/commit/527d6784fe53df7d1b84d61f36835e7877ddea6c))
* **e2e:** sticky and scrollable content inside shadow roots ([5c36a28](https://github.com/smollet-app/screencappy/commit/5c36a28adc67732c20b221f7a6b00a56cfb95378))
* **e2e:** witness for the parallax background fix ([ab2ab0f](https://github.com/smollet-app/screencappy/commit/ab2ab0f8aa13539a4c460a4f8964e78b827d5fe1))
* **ui:** cover the new reporting, and stop describing controls twice ([ec97f1b](https://github.com/smollet-app/screencappy/commit/ec97f1b8d1654f739d8185d8deb9669937245189))
* **ui:** cover the roving toolbars, the colour popover and the one-row bar ([dae1f12](https://github.com/smollet-app/screencappy/commit/dae1f12f69c317a4b11e01715c73c6aa7b5b4075))
* **ui:** exhaustive control sweep with the fixes it motivated ([f7f839f](https://github.com/smollet-app/screencappy/commit/f7f839f4c83ff141b889bf76ab61fd93af6b8e04))
* **ui:** sweep every control, photograph every state, drive both overlays ([90e5450](https://github.com/smollet-app/screencappy/commit/90e54504d26b8a97c247600dc8b660df2bdba3d3))

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
