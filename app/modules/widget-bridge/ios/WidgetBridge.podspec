Pod::Spec.new do |s|
  s.name           = 'WidgetBridge'
  s.version        = '0.1.0'
  s.summary        = 'GoldFinch weekly-spend widget bridge: writes the snapshot JSON to the App Group shared container and reloads WidgetKit timelines.'
  s.description    = 'Local Expo module. JS resolves it via requireOptionalNativeModule(\'WidgetBridge\').'
  s.author         = 'GoldFinch'
  s.homepage       = 'https://github.com/goldfinch-app/goldfinch'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
