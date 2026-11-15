(function (global) {
  const supabaseProductImagePrefix = 'https://ueptjmsurtshpcldpxxp.supabase.co/storage/v1/object/public/product-images/books/';
  const localProductCovers = new Set([
    '1789830466217-leb8f.jpg',
    '1789830466519-4hsxk.jpg',
    '1789830467582-p1w27.jpg',
    '1789893959690-gpoac.jpg',
    '1789893974804-he3vu.jpg',
    '1789894028369-e9yst.jpg',
    '1790136984031-g1kfg.png',
    '1790136989898-0khy2.png',
    '1790136993699-92nn4.png',
    '1790137000398-pa8rj.png',
    '1790164179304-44b3u.png',
    '1792307499236-y6m1c.jpg',
    '1792801380492-5bamu.png',
    '1792801381406-5yuzn.png',
    '1792801382000-n2rym.png',
    '1792801382516-k4zyh.png',
    '1792801383070-kd6wc.png',
    '1792801746608-x73ke.png',
    '1792801747148-dnoo7.png',
    '1792801747797-xgw52.png',
    '1792801748245-8sjw1.png',
    '1792801748894-jqngf.png',
    '1793442816927-l4q5o.png',
    '1793442820748-e8qa0.png',
    '1793442824648-4yuwp.png',
    '1793442828196-empby.png',
    '1793442831403-j08hg.png',
    '1793442834751-vyjb0.png',
    '1793442842651-x5xvg.png',
    '1793442845581-pl73e.png',
    '1793442849370-4shh2.png',
    '1793442852424-u4jjw.png',
    '1793445251070-ww6t7.png',
    '1793446050981-i8mz6.png',
    '1793446528438-5skv3.png',
    '1793446610672-nnwbv.png',
    '1793446614567-a6706.png',
    '1793446617766-ljved.png',
    '1793446621298-wpmjf.png',
    '1793446625706-jicag.png',
    '1793448534104-6wkjq.png',
    '1793449268671-6es3i.png',
    '1793449501783-kg5mn.png',
    '1793449507718-yxkqk.png',
    '1793449510640-crge2.png',
    '1793449602740-0zhkc.png',
    '1793539697914-g77b5.png',
    '1793539699417-tilvv.png',
    '1793539700088-cj9rh.png',
    '1793539836113-cf05c.png'
  ]);

  function getBookImageUrl(source) {
    if (typeof source !== 'string') return '';
    if (!source.startsWith(supabaseProductImagePrefix)) return source;

    const objectName = source.slice(supabaseProductImagePrefix.length).split(/[?#]/, 1)[0];
    if (!objectName || objectName.includes('/') || !localProductCovers.has(objectName)) return source;
    return `book-covers/${encodeURIComponent(objectName)}`;
  }

  global.getBookImageUrl = getBookImageUrl;
})(window);
