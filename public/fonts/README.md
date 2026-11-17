# الخطوط المرفقة

خطوط عربية مرفقة مع مونتاجي حتى تظهر النصوص بالشكل نفسه في المعاينة والتصدير على أي جهاز،
دون اتصال بالإنترنت. كلها من Google Fonts برخصة SIL Open Font License 1.1 (OFL)، لا برخصة MIT
التي يحملها كود مونتاجي. نص الرخصة الكامل لكل خط مع سطر حقوقه في مجلد [licenses](licenses).

الرخصة تسمح باستعمال الخطوط وإرفاقها مع البرامج وتوزيعها معها، ولو تجارياً، وبوضعها في الفيديوهات
والصور المصدّرة دون أي شرط على تلك الفيديوهات. ولا تسمح ببيع ملفات الخطوط وحدها. ومن يوزّع ملفات
الخطوط (ضمن نسخة من مونتاجي مثلاً) يُبقي مجلد licenses معها.

| المفتاح في المشروع | الخط | الحقوق (من ملف الرخصة) | الرخصة |
| --- | --- | --- | --- |
| cairo | Cairo | Copyright 2009 The Cairo Project Authors | [OFL 1.1](licenses/cairo-OFL.txt) |
| tajawal | Tajawal | Copyright 2018 Boutros International | [OFL 1.1](licenses/tajawal-OFL.txt) |
| almarai | Almarai | Copyright 2019 The Almarai Project Authors | [OFL 1.1](licenses/almarai-OFL.txt) |
| changa | Changa | Copyright 2018 The Changa Project Authors | [OFL 1.1](licenses/changa-OFL.txt) |
| reemkufi | Reem Kufi | Copyright 2015-2022 The Reem Kufi Project Authors | [OFL 1.1](licenses/reemkufi-OFL.txt) |
| elmessiri | El Messiri | Copyright 2015 The El Messiri Project Authors | [OFL 1.1](licenses/elmessiri-OFL.txt) |
| amiri | Amiri | Copyright 2010-2022 The Amiri Project Authors | [OFL 1.1](licenses/amiri-OFL.txt) |
| lalezar | Lalezar | Copyright 2015 The Lalezar Project Authors | [OFL 1.1](licenses/lalezar-OFL.txt) |

لكل خط ملفان: `<المفتاح>-400.ttf` و`<المفتاح>-700.ttf` (لاله‌زار وزن واحد فقط).

## إضافة خط

1. استعمل خطاً برخصة تسمح بإرفاقه مع البرنامج (OFL أو Apache 2.0 مثلاً)، لا خطاً تجارياً أو «للاستعمال الشخصي».
2. ضع ملفاته هنا، وضع نص رخصته الكامل في `licenses/<المفتاح>-OFL.txt` (من مجلد الخط في
   https://github.com/google/fonts إن كان من Google Fonts)، وأضف سطره إلى الجدول أعلاه.
3. أضفه إلى `FONTS` في `js/render.js` وإلى قائمتي الخطوط في `js/tools.js` و`js/projecttools.js`.
   الاختبارات في `test/projecttools.test.js` تتحقق أن القوائم متطابقة وأن لكل خط ملفه ورخصته.
