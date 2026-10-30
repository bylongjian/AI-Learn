export default defineAppConfig({
  pages: ['pages/index/index', 'pages/quiz/index', 'pages/report/index', 'pages/library/index', 'pages/profile/index'],
  window: { navigationStyle: 'custom', backgroundColor: '#fff9f5', navigationBarTextStyle: 'black' },
  ...(process.env.TARO_ENV === 'weapp' ? {
    usingComponents: {},
    tabBar: {
      custom: true,
      color: '#626a75', selectedColor: '#c6531a', backgroundColor: '#fff9f5',
      list: [
        { pagePath: 'pages/index/index', text: '闯关' },
        { pagePath: 'pages/library/index', text: '题库' },
        { pagePath: 'pages/profile/index', text: '我的' },
      ],
    },
  } : {}),
})
