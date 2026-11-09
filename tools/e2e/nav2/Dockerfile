FROM ros:jazzy-ros-base
RUN apt-get update && apt-get install -y --no-install-recommends \
      ros-jazzy-navigation2 ros-jazzy-nav2-bringup ros-jazzy-nav2-loopback-sim \
      python3-websockets \
    && rm -rf /var/lib/apt/lists/*
