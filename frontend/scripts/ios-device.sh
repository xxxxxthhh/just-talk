#!/bin/sh
# Build, sign, and install the app on a physical iPhone.
# IOS_DEVICE_ID and IOS_DEVELOPMENT_TEAM come from the environment or, if
# unset there, from the git-ignored frontend/.env.ios-device.local.
set -eu
cd "$(dirname "$0")/.."

device_id="${IOS_DEVICE_ID:-}"
team_id="${IOS_DEVELOPMENT_TEAM:-}"
if [ -f .env.ios-device.local ]; then
  . ./.env.ios-device.local
fi
IOS_DEVICE_ID="${device_id:-${IOS_DEVICE_ID:-}}"
IOS_DEVELOPMENT_TEAM="${team_id:-${IOS_DEVELOPMENT_TEAM:-}}"
: "${IOS_DEVICE_ID:?Set IOS_DEVICE_ID to your iPhone UDID (or add it to .env.ios-device.local)}"
: "${IOS_DEVELOPMENT_TEAM:?Set IOS_DEVELOPMENT_TEAM to your Apple signing team ID (or add it to .env.ios-device.local)}"

npm run build:ios
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination "id=$IOS_DEVICE_ID" -derivedDataPath ios/DerivedData \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$IOS_DEVELOPMENT_TEAM" build
xcrun devicectl device install app --device "$IOS_DEVICE_ID" \
  ios/DerivedData/Build/Products/Debug-iphoneos/App.app
