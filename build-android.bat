@echo off
set ANDROID_HOME=C:\Users\dapen\AppData\Local\Android\Sdk
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%
cd /d C:\Users\dapen\TileCalc
npx expo run:android
