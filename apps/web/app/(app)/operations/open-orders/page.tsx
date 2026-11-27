import {Suspense} from 'react';
import {CardSkeleton} from '@/components/ds';
import {CustomerOrderRegisterWorkspace} from '@/features/order-imports/register';
export default function Page(){return <Suspense fallback={<CardSkeleton/>}><CustomerOrderRegisterWorkspace view="OPEN_ORDERS"/></Suspense>;}
