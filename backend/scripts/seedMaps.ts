import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { load } from 'js-yaml';

const prisma = new PrismaClient() as any;

async function main() {
  console.log('Seeding database...');

  // Paths to assets
  const assetsDir = path.join(process.cwd(), '../frontend/public/assets');

  // Map 1 Data
  const map1Pgm = await fs.readFile(path.join(assetsDir, 'map.pgm'));
  const map1Yaml = await fs.readFile(path.join(assetsDir, 'map.yaml'), 'utf-8');
  const map1Metadata = load(map1Yaml) as any;
  const map1Features = {
    locationTags: [
      { id: 'home', name: 'Home Base', x: -153, y: -34, theta: -1.387 }, // 79.47 deg -> 1.387 rad
      { id: 'dock', name: 'Docking Station', x: -75.33, y: -18.6, theta: 0 },
    ],
    missions: [
      {
        id: 'patrol',
        name: 'Warehouse Patrol',
        steps: ['home', 'dock', 'home'],
      },
      {
        id: 'inspection',
        name: 'Daily Inspection',
        steps: ['home', 'dock'],
      },
    ],
  };

  // Map 2 Data
  const map2Pgm = await fs.readFile(path.join(assetsDir, 'map2.pgm'));
  const map2Yaml = await fs.readFile(path.join(assetsDir, 'map2.yaml'), 'utf-8');
  const map2Metadata = load(map2Yaml) as any;
  const map2Features = {
    locationTags: [
      { id: 'station_a', name: 'Station A', x: 3.22933, y: -36.12, theta: -2.95 }, // -169 deg -> -2.95 rad
      { id: 'station_b', name: 'Station B', x: -8.27, y: -37.66, theta: 2.98 }, // 171 deg -> 2.98 rad
    ],
    missions: [
      {
        id: 'loop',
        name: 'Continuous Loop',
        steps: ['station_a', 'station_b', 'station_a', 'station_b'],
      },
    ],
  };

  const map3Pgm = await fs.readFile(path.join(assetsDir, 'gas_station_map.pgm'));
  const map3Yaml = await fs.readFile(path.join(assetsDir, 'gas_station_map.yaml'), 'utf-8');
  const map3Metadata = load(map3Yaml) as any;
  const map3Features = {
    locationTags: [
      { id: 'home', name: 'Home Base', x: -153, y: -34, theta: -1.387 }, // 79.47 deg -> 1.387 rad
      { id: 'dock', name: 'Docking Station', x: -75.33, y: -18.6, theta: 0 },
    ],
    missions: [
      {
        id: 'patrol',
        name: 'Warehouse Patrol',
        steps: ['home', 'dock', 'home'],
      },
      {
        id: 'inspection',
        name: 'Daily Inspection',
        steps: ['home', 'dock'],
      },
    ],
  };
  // Create Maps
  console.log('Creating maps...');
  const map1 = await prisma.map.upsert({
    where: { name: 'Warehouse Floor 1' },
    update: {
      image: map1Pgm,
      metadata: map1Metadata,
      features: map1Features,
    },
    create: {
      name: 'Warehouse Floor 1',
      image: map1Pgm,
      metadata: map1Metadata,
      features: map1Features,
    },
  });

  const map2 = await prisma.map.upsert({
    where: { name: 'Warehouse Floor 2' },
    update: {
      image: map2Pgm,
      metadata: map2Metadata,
      features: map2Features,
    },
    create: {
      name: 'Warehouse Floor 2',
      image: map2Pgm,
      metadata: map2Metadata,
      features: map2Features,
    },
  });
  const map3 = await prisma.map.upsert({
    where: { name: 'Gas Station' },
    update: {
      image: map3Pgm,
      metadata: map3Metadata,
      features: map3Features,
    },
    create: {
      name: 'Gas Station',
      image: map3Pgm,
      metadata: map3Metadata,
      features: map3Features,
    },
  });

  console.log('Maps created:', map1.id, map2.id, map3.id);

  // Create Robots
  console.log('Creating robots...');
  const robots = [
    {
      name: 'Tensrai1',
      status: 'MISSION',
      mapId: map3.id,
      x: -153,
      y: -79,
      theta: 1.387,
      battery: 100,
    },
    {
      name: 'Tensrai2',
      status: 'MISSION',
      mapId: map2.id,
      x: 3.22933,
      y: -36.12,
      theta: -2.95,
      battery: 95,
    },
  ];

  for (const robot of robots) {
    await prisma.robot.upsert({
      where: { name: robot.name },
      update: {
        status: robot.status as any,
        mapId: robot.mapId,
        x: robot.x,
        y: robot.y,
        theta: robot.theta,
        battery: robot.battery,
      },
      create: {
        name: robot.name,
        status: robot.status as any,
        mapId: robot.mapId,
        x: robot.x,
        y: robot.y,
        theta: robot.theta,
        battery: robot.battery,
      },
    });
  }

  console.log('Seeding completed.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
